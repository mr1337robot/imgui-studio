/**
 * Resolves one immutable successful build into a deterministic native integration package.
 *
 * The exporter never traverses the mutable project root. It copies only paths selected from the
 * build-owned snapshot and trusted Studio runtime allowlists, generates the integration boundary,
 * verifies a clean packaged native build, and atomically promotes the completed directory.
 */
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import pngjs from 'pngjs';
import type { BuildCoordinator } from './build-coordinator.ts';
import { normalizeProjectPath, sha256, writeAtomic } from './filesystem.ts';
import type { PreviewCoordinator } from './preview-coordinator.ts';
import type { ProjectService } from './project-service.ts';
import { ServiceError } from './service-error.ts';
import type { ExportFile, ExportRecord, ProjectFile } from './types.ts';

const { PNG } = pngjs;
const maximumExportFiles = 4096;
const maximumExportBytes = 128 * 1024 * 1024;
const nativeCaptureTimeUs = 33_334;

interface ExportRequest {
  readonly buildId: string;
  readonly format: string;
  readonly outputName: string;
  readonly verifyNativeParity: boolean;
  readonly confirmOlderRevision: boolean;
}

interface AssetDeclaration {
  readonly id: string;
  readonly kind: 'texture' | 'font' | 'svgIcon';
  readonly source: string;
  readonly licenseFiles: readonly string[];
}

interface ProjectExportManifest {
  readonly name: string;
  readonly projectKey: string;
  readonly renderingTier: string;
  readonly language: { readonly cppStandard: 20 };
  readonly toolchain: Readonly<Record<string, string>>;
  readonly viewport: {
    readonly widthPx: number;
    readonly heightPx: number;
    readonly dpiScaleMilli: number;
  };
  readonly assetsManifest: string;
  readonly export: {
    readonly publicHeaders: readonly string[];
    readonly sourceGlobs: readonly string[];
    readonly licenseGlobs: readonly string[];
  };
}

/** Coordinates deterministic directory exports for one active project. */
export class ExportService {
  readonly #records = new Map<string, ExportRecord>();

  public constructor(
    private readonly repositoryRoot: string,
    private readonly project: ProjectService,
    private readonly builds: BuildCoordinator,
    private readonly previews: PreviewCoordinator,
  ) {}

  /**
   * Rehydrates successful export records after a service restart.
   *
   * Only records whose package directory and complete digest inventory still validate are exposed.
   * A partially written, manually modified, or corrupt export stays on disk for diagnosis but is
   * not returned as authoritative state.
   */
  public async initialize(): Promise<void> {
    const exportsRoot = resolve(this.project.root, '.studio/exports');
    await mkdir(exportsRoot, { recursive: true });
    for (const entry of await readdir(exportsRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.startsWith('exp_')) continue;
      try {
        const encoded = await readFile(
          resolve(exportsRoot, entry.name, 'export-record.json'),
          'utf8',
        );
        const record: unknown = JSON.parse(encoded);
        if (!isPersistedExportRecord(record, entry.name, this.project.projectId)) continue;
        const packageRoot = resolve(exportsRoot, entry.name, record.outputName);
        for (const file of record.files) {
          const path = normalizeProjectPath(file.path);
          const bytes = await readFile(resolve(packageRoot, ...path.split('/')));
          if (bytes.byteLength !== file.sizeBytes || sha256(bytes) !== file.sha256) {
            throw new Error('Persisted export inventory digest mismatch.');
          }
        }
        this.#records.set(record.exportId, record);
      } catch {
        // Recovery is intentionally per-export: one corrupt package must not prevent service start.
      }
    }
  }

  /** Returns an immutable view of a previously started export. */
  public get(exportId: string): ExportRecord {
    const record = this.#records.get(exportId);
    if (!record) {
      throw new ServiceError('FILE_NOT_FOUND', 'The requested export does not exist.', 404, false);
    }
    return structuredClone(record);
  }

  /** Builds, verifies, and atomically promotes one self-contained directory package. */
  public async start(request: ExportRequest): Promise<ExportRecord> {
    validateRequest(request);
    const selected = await this.builds.resolveSuccessfulInput(request.buildId);
    const staleSource = selected.record.projectRevision !== this.project.currentRevision;
    if (staleSource && !request.confirmOlderRevision) {
      throw new ServiceError(
        'REVISION_CONFLICT',
        'The selected successful build is older than the active project revision.',
        409,
        false,
        {
          selectedRevision: selected.record.projectRevision,
          currentRevision: this.project.currentRevision,
          confirmationRequired: true,
        },
      );
    }

    const exportId = `exp_${randomUUID()}`;
    const record: ExportRecord = {
      schemaVersion: 1,
      exportId,
      projectId: this.project.projectId,
      projectRevision: selected.record.projectRevision,
      buildId: selected.record.buildId,
      outputName: request.outputName,
      format: 'directory',
      status: 'resolving',
      staleSource,
      warnings: staleSource
        ? ['Exported an explicitly confirmed older successful project revision.']
        : [],
      packageDirectory: null,
      files: [],
      verification: {
        status: 'pending',
        geometryMaximumDifferencePx: null,
        reportPath: null,
      },
    };
    this.#records.set(exportId, record);

    const exportsRoot = resolve(this.project.root, '.studio/exports');
    const stagingRoot = resolve(exportsRoot, `.${exportId}.stage`);
    const packageRoot = resolve(stagingRoot, request.outputName);
    const finalRoot = resolve(exportsRoot, exportId);
    const verificationWork = resolve(exportsRoot, `.${exportId}.verification`);
    await mkdir(exportsRoot, { recursive: true });
    await rm(stagingRoot, { recursive: true, force: true });
    await rm(verificationWork, { recursive: true, force: true });

    try {
      record.status = 'packaging';
      const manifest = await readSnapshotJson<ProjectExportManifest>(
        selected.snapshotDirectory,
        'studio.project.json',
      );
      if (manifest.renderingTier !== 'portable') {
        throw new ServiceError(
          'UNSUPPORTED_RENDERING_TIER',
          'The MVP exporter supports only portable projects.',
          400,
          false,
        );
      }
      const assets = await readAssets(selected.snapshotDirectory, manifest.assetsManifest);
      const projectPaths = resolveProjectGraph(selected.input.files, manifest, assets);
      await copyProjectGraph(selected.snapshotDirectory, packageRoot, projectPaths);
      await copyRuntimeSubset(this.repositoryRoot, packageRoot);

      const namespaceName = sanitizeIdentifier(manifest.projectKey);
      const starterHash = await calculateStarterSourceHash(
        selected.snapshotDirectory,
        projectPaths.filter((path) => isCxx(path)),
      );
      const portabilityWarnings = await scanPortability(packageRoot, projectPaths);
      record.warnings.push(...portabilityWarnings);
      await writeGeneratedPackage(
        packageRoot,
        manifest,
        namespaceName,
        projectPaths,
        assets,
        starterHash,
        selected.input.sourceDigest,
      );
      await copyNativeVerificationFixture(this.repositoryRoot, packageRoot, namespaceName);

      record.status = 'verifying';
      const verification = request.verifyNativeParity
        ? await verifyPackage(
            this.repositoryRoot,
            packageRoot,
            verificationWork,
            this.previews,
            selected.record.buildId,
            selected.record.projectRevision,
            starterHash,
          )
        : {
            geometryMaximumDifferencePx: null,
            nativeMetadata: null,
            pixelDiagnostics: null,
          };
      if (
        verification.geometryMaximumDifferencePx !== null &&
        verification.geometryMaximumDifferencePx > 2
      ) {
        throw new ServiceError(
          'EXPORT_VERIFICATION_FAILED',
          'Exported package geometry exceeded the two-pixel parity tolerance.',
          409,
          false,
          { geometryMaximumDifferencePx: verification.geometryMaximumDifferencePx },
        );
      }

      const verificationDirectory = resolve(packageRoot, 'verification');
      await mkdir(verificationDirectory, { recursive: true });
      if (request.verifyNativeParity) {
        await copyFile(
          resolve(verificationWork, 'native.png'),
          resolve(verificationDirectory, 'native.png'),
        );
        await copyFile(
          resolve(verificationWork, 'native.metadata.json'),
          resolve(verificationDirectory, 'native.metadata.json'),
        );
        await copyFile(
          resolve(verificationWork, 'browser.png'),
          resolve(verificationDirectory, 'browser.png'),
        );
      }
      const report = exportReport(
        record,
        manifest,
        selected.input.sourceDigest,
        selected.input.assetDigest,
        assets,
        portabilityWarnings,
        verification,
      );
      await writeAtomic(
        resolve(packageRoot, 'studio-export.json'),
        `${JSON.stringify(report, null, 2)}\n`,
      );
      await writeAtomic(
        resolve(verificationDirectory, 'report.json'),
        `${JSON.stringify(report.verification, null, 2)}\n`,
      );
      await writeChecksums(packageRoot);
      record.files = await inventoryPackage(packageRoot);
      record.verification = {
        status: request.verifyNativeParity ? 'passed' : 'pending',
        geometryMaximumDifferencePx: verification.geometryMaximumDifferencePx,
        reportPath: 'verification/report.json',
      };
      record.status = 'succeeded';
      await writeAtomic(
        resolve(stagingRoot, 'export-record.json'),
        `${JSON.stringify(record, null, 2)}\n`,
      );
      await rename(stagingRoot, finalRoot);
      record.packageDirectory = `.studio/exports/${exportId}/${request.outputName}`;
      await writeAtomic(
        resolve(finalRoot, 'export-record.json'),
        `${JSON.stringify(record, null, 2)}\n`,
      );
      return structuredClone(record);
    } catch (error) {
      record.status = 'failed';
      record.verification.status = 'failed';
      const failure =
        error instanceof ServiceError
          ? { code: error.code, message: error.message, details: error.details }
          : { code: 'INTERNAL_ERROR', message: 'Unexpected export failure.', details: {} };
      await writeAtomic(
        resolve(exportsRoot, `${exportId}.failed.json`),
        `${JSON.stringify({ schemaVersion: 1, exportId, record, failure }, null, 2)}\n`,
      );
      await rm(stagingRoot, { recursive: true, force: true });
      throw error;
    } finally {
      await rm(verificationWork, { recursive: true, force: true });
    }
  }
}

function validateRequest(request: ExportRequest): void {
  if (
    typeof request.buildId !== 'string' ||
    request.format !== 'directory' ||
    !/^[a-z][a-z0-9-]{0,62}$/.test(request.outputName) ||
    typeof request.verifyNativeParity !== 'boolean' ||
    typeof request.confirmOlderRevision !== 'boolean'
  ) {
    throw new ServiceError(
      'INVALID_REQUEST',
      'Export requires buildId, directory format, safe outputName, verification, and confirmation.',
      400,
      false,
    );
  }
}

async function readSnapshotJson<T>(snapshotRoot: string, logicalPath: string): Promise<T> {
  const normalized = normalizeProjectPath(logicalPath);
  try {
    return JSON.parse(await readFile(resolve(snapshotRoot, ...normalized.split('/')), 'utf8')) as T;
  } catch {
    throw new ServiceError(
      'EXPORT_REQUIRES_SUCCESSFUL_BUILD',
      'A selected build manifest is missing or malformed.',
      409,
      false,
      { path: normalized },
    );
  }
}

async function readAssets(snapshotRoot: string, manifestPath: string): Promise<AssetDeclaration[]> {
  const manifest = await readSnapshotJson<{ assets: AssetDeclaration[] }>(
    snapshotRoot,
    manifestPath,
  );
  return manifest.assets;
}

function resolveProjectGraph(
  files: readonly ProjectFile[],
  manifest: ProjectExportManifest,
  assets: readonly AssetDeclaration[],
): string[] {
  const recorded = new Set(files.map((file) => normalizeProjectPath(file.path)));
  const patterns = [...manifest.export.publicHeaders, ...manifest.export.sourceGlobs];
  const selected = [...recorded].filter((path) =>
    patterns.some((pattern) => globMatches(pattern, path)),
  );
  selected.push(normalizeProjectPath(manifest.assetsManifest));
  for (const asset of assets) {
    selected.push(normalizeProjectPath(asset.source));
    selected.push(...asset.licenseFiles.map(normalizeProjectPath));
  }
  for (const path of recorded) {
    if (manifest.export.licenseGlobs.some((pattern) => globMatches(pattern, path)))
      selected.push(path);
  }
  const unique = [...new Set(selected)].sort(comparePath);
  if (unique.length > maximumExportFiles || unique.some((path) => !recorded.has(path))) {
    throw new ServiceError(
      'EXPORT_REQUIRES_SUCCESSFUL_BUILD',
      'The export graph references unavailable or excessive project inputs.',
      409,
      false,
    );
  }
  return unique;
}

function globMatches(pattern: string, path: string): boolean {
  const expression = normalizeProjectPath(pattern)
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replaceAll('**', '\u0000')
    .replaceAll('*', '[^/]*')
    .replaceAll('\u0000', '.*');
  return new RegExp(`^${expression}$`).test(path);
}

async function copyProjectGraph(
  snapshotRoot: string,
  packageRoot: string,
  paths: readonly string[],
): Promise<void> {
  for (const logicalPath of paths) {
    const source = resolve(snapshotRoot, ...logicalPath.split('/'));
    const status = await lstat(source);
    if (!status.isFile() || status.isSymbolicLink()) {
      throw new ServiceError(
        'EXPORT_REQUIRES_SUCCESSFUL_BUILD',
        'Export inputs must be regular files.',
        409,
        false,
        { path: logicalPath },
      );
    }
    await copyFileCreatingParent(source, resolve(packageRoot, ...logicalPath.split('/')));
  }
}

async function copyRuntimeSubset(repositoryRoot: string, packageRoot: string): Promise<void> {
  const includeRoot = resolve(repositoryRoot, 'runtime/include/studio');
  for (const entry of (await readdir(includeRoot, { withFileTypes: true })).sort((a, b) =>
    comparePath(a.name, b.name),
  )) {
    if (!entry.isFile() || !entry.name.endsWith('.hpp')) continue;
    await copyFileCreatingParent(
      resolve(includeRoot, entry.name),
      resolve(packageRoot, 'studio_runtime/include/studio', entry.name),
    );
  }
  await copyFileCreatingParent(
    resolve(repositoryRoot, 'runtime/src/runtime.cpp'),
    resolve(packageRoot, 'studio_runtime/src/runtime.cpp'),
  );
}

async function writeGeneratedPackage(
  packageRoot: string,
  manifest: ProjectExportManifest,
  namespaceName: string,
  projectPaths: readonly string[],
  assets: readonly AssetDeclaration[],
  starterHash: string,
  sourceDigest: string,
): Promise<void> {
  const projectSources = projectPaths.filter((path) => /^(?:src)\/.*\.cpp$/i.test(path));
  const sourceList = projectSources.map((path) => `    "${path}"`).join('\n');
  const targetName = `${namespaceName}_menu`;
  await writeAtomic(
    resolve(packageRoot, 'CMakeLists.txt'),
    `cmake_minimum_required(VERSION 3.25)\nproject(${namespaceName} LANGUAGES CXX)\n\nset(IMGUI_TARGET "" CACHE STRING "Existing Dear ImGui CMake target")\nif(IMGUI_TARGET STREQUAL "")\n    if(TARGET DearImGui::Core)\n        set(IMGUI_TARGET DearImGui::Core)\n    elseif(TARGET imgui)\n        set(IMGUI_TARGET imgui)\n    else()\n        message(FATAL_ERROR "Set IMGUI_TARGET to the consumer's existing Dear ImGui target")\n    endif()\nendif()\nif(NOT TARGET \${IMGUI_TARGET})\n    message(FATAL_ERROR "IMGUI_TARGET does not name an existing target")\nendif()\n\nadd_library(${targetName} STATIC\n${sourceList}\n    "studio_runtime/src/runtime.cpp"\n    "generated/integration.cpp"\n    "generated/asset_registry.cpp"\n)\nadd_library(${namespaceName}::menu ALIAS ${targetName})\ntarget_compile_features(${targetName} PUBLIC cxx_std_20)\ntarget_compile_definitions(${targetName} PRIVATE STUDIO_STARTER_SOURCE_SHA256="${starterHash}")\ntarget_include_directories(${targetName} PUBLIC\n    "$<BUILD_INTERFACE:\${CMAKE_CURRENT_SOURCE_DIR}/include>"\n    "$<BUILD_INTERFACE:\${CMAKE_CURRENT_SOURCE_DIR}/studio_runtime/include>"\n    "$<BUILD_INTERFACE:\${CMAKE_CURRENT_SOURCE_DIR}/generated>"\n)\ntarget_link_libraries(${targetName} PUBLIC \${IMGUI_TARGET})\nset_target_properties(${targetName} PROPERTIES VS_GLOBAL_VcpkgEnabled false VS_GLOBAL_VcpkgAppLocalDeps false)\n`,
  );
  await writeAtomic(
    resolve(packageRoot, 'cmake/ImGuiStudioExport.cmake'),
    `# Include after defining the consumer's Dear ImGui target, then add_subdirectory the package.\nset(IMGUI_STUDIO_EXPORT_CPP_STANDARD 20)\nset(IMGUI_STUDIO_EXPORT_SOURCE_SHA256 "${sourceDigest}")\n`,
  );
  await writeAtomic(
    resolve(packageRoot, `include/${namespaceName}/integration.hpp`),
    integrationHeader(namespaceName),
  );
  await writeAtomic(
    resolve(packageRoot, 'generated/integration.cpp'),
    integrationSource(namespaceName),
  );
  await writeAtomic(
    resolve(packageRoot, 'generated/asset_registry.hpp'),
    assetRegistryHeader(namespaceName),
  );
  await writeAtomic(
    resolve(packageRoot, 'generated/asset_registry.cpp'),
    assetRegistrySource(namespaceName, assets),
  );
  await writeAtomic(
    resolve(packageRoot, 'generated/font_atlas_config.cpp'),
    `// Generated deterministic font declarations. No project fonts are declared in this package.\n`,
  );
  await writeAtomic(
    resolve(packageRoot, 'generated/studio_export_config.hpp'),
    `#pragma once\n\n#define IMGUI_STUDIO_EXPORT_SOURCE_SHA256 "${sourceDigest}"\n#define IMGUI_STUDIO_EXPORT_RUNTIME_VERSION "${manifest.toolchain.studioRuntimeVersion ?? ''}"\n#define IMGUI_STUDIO_EXPORT_IMGUI_VERSION "${manifest.toolchain.imguiVersion ?? ''}"\n`,
  );
  await writeAtomic(resolve(packageRoot, 'README.md'), packageReadme(manifest, namespaceName));
  await writeAtomic(resolve(packageRoot, 'LICENSES.md'), licensesDocument(assets));
}

function integrationHeader(namespaceName: string): string {
  return `#pragma once\n\n#include <functional>\n#include <studio_example/menu.hpp>\n\nnamespace ${namespaceName} {\n\nusing State = studio_example::MenuState;\nusing Diagnostics = studio_example::MenuDiagnostics;\n\n/// Consumer callbacks are invoked synchronously on the Dear ImGui render thread.\nstruct Events final {\n    std::function<void(const Diagnostics&)> onRendered{};\n};\n\n/// No-op portable initialization hook retained for a stable consumer lifecycle.\nvoid Initialize() noexcept;\n/// Restores project-owned sample state without touching the consumer's ImGui context.\nvoid Reset(State& state) noexcept;\n/// Renders between ImGui::NewFrame and ImGui::Render on the current ImGui thread.\n[[nodiscard]] Diagnostics Render(State& state, const Events& events = {});\n/// No-op portable shutdown hook; call it before destroying the ImGui context.\nvoid Shutdown() noexcept;\n\n} // namespace ${namespaceName}\n`;
}

function integrationSource(namespaceName: string): string {
  return `#include <${namespaceName}/integration.hpp>\n\nnamespace ${namespaceName} {\n\nvoid Initialize() noexcept {}\n\nvoid Reset(State& state) noexcept {\n    studio_example::ResetMenuState(state);\n}\n\nDiagnostics Render(State& state, const Events& events) {\n    return studio_example::RenderMenu(\n        state, {.onRendered = events.onRendered});\n}\n\nvoid Shutdown() noexcept {}\n\n} // namespace ${namespaceName}\n`;
}

function assetRegistryHeader(namespaceName: string): string {
  return `#pragma once\n\n#include <span>\n#include <string_view>\n\nnamespace ${namespaceName}::assets {\n\nstruct Declaration final {\n    std::string_view id;\n    std::string_view kind;\n    std::string_view source;\n};\n\n[[nodiscard]] std::span<const Declaration> Declarations() noexcept;\n\n} // namespace ${namespaceName}::assets\n`;
}

function assetRegistrySource(namespaceName: string, assets: readonly AssetDeclaration[]): string {
  const entries = assets
    .map((asset) => `    {"${asset.id}", "${asset.kind}", "${asset.source}"},`)
    .join('\n');
  return `#include "asset_registry.hpp"\n\n#include <array>\n\nnamespace ${namespaceName}::assets {\nnamespace {\nconstexpr std::array<Declaration, ${String(assets.length)}> declarations{{\n${entries}\n}};\n} // namespace\n\nstd::span<const Declaration> Declarations() noexcept {\n    return declarations;\n}\n\n} // namespace ${namespaceName}::assets\n`;
}

function packageReadme(manifest: ProjectExportManifest, namespaceName: string): string {
  return `# ${manifest.name} Native Package\n\nThis directory was assembled from one immutable, smoke-passed ImGui Studio build. User-owned source remains under \`include/\`, \`src/\`, and \`assets/\`; \`generated/\`, \`studio_runtime/\`, \`cmake/\`, and \`verification/\` are export products.\n\n## Integrate\n\nDefine or import one Dear ImGui CMake target, then:\n\n\`\`\`cmake\nset(IMGUI_TARGET my_imgui_target CACHE STRING "" FORCE)\nadd_subdirectory(path/to/${manifest.projectKey})\ntarget_link_libraries(my_app PRIVATE ${namespaceName}::menu)\n\`\`\`\n\nInclude \`<${namespaceName}/integration.hpp>\`. Call \`Initialize()\` after the ImGui context/backend exists, call \`Render(state, events)\` between \`ImGui::NewFrame()\` and \`ImGui::Render()\` on that thread, and call \`Shutdown()\` before destroying the context. The consumer owns \`State\` and callback lifetimes.\n\nThe package never creates a platform window, renderer backend, frame, or present operation. See \`studio-export.json\` and \`SHA256SUMS\` for provenance and integrity.\n`;
}

function licensesDocument(assets: readonly AssetDeclaration[]): string {
  const lines = assets.flatMap((asset) =>
    asset.licenseFiles.map((path) => `- \`${asset.id}\`: \`${path}\``),
  );
  return `# Asset Licenses and Attributions\n\n${lines.length === 0 ? 'No project asset licenses were declared.' : lines.join('\n')}\n`;
}

async function copyNativeVerificationFixture(
  repositoryRoot: string,
  packageRoot: string,
  namespaceName: string,
): Promise<void> {
  for (const name of ['main.cpp', 'capture.cpp', 'capture.hpp']) {
    await copyFileCreatingParent(
      resolve(repositoryRoot, 'runtime/native', name),
      resolve(packageRoot, 'examples/native', name),
    );
  }
  await writeAtomic(
    resolve(packageRoot, 'examples/native/consumer_contract.cpp'),
    consumerContractSource(namespaceName),
  );
  await writeAtomic(
    resolve(packageRoot, 'examples/native/CMakeLists.txt'),
    nativeFixtureCmake(namespaceName),
  );
}

function consumerContractSource(namespaceName: string): string {
  return `#include <${namespaceName}/integration.hpp>\n#include <imgui.h>\n#include <studio/runtime.hpp>\n\nint main() {\n    IMGUI_CHECKVERSION();\n    ImGuiContext* imgui = ImGui::CreateContext();\n    ImGuiIO& io = ImGui::GetIO();\n    io.DisplaySize = {900.0F, 600.0F};\n    io.DeltaTime = 1.0F / 60.0F;\n    unsigned char* pixels = nullptr;\n    int width = 0;\n    int height = 0;\n    io.Fonts->GetTexDataAsRGBA32(&pixels, &width, &height);\n    ImGui::NewFrame();\n    studio::ProjectContext runtime(*imgui, {.mode = studio::RuntimeMode::Deterministic});\n    studio::BeginFrame(runtime, {.frameIndex = 0, .absoluteTimeUs = 0, .deltaTimeUs = 0, .viewportPixels = io.DisplaySize, .dpiScale = 1.0F});\n    ${namespaceName}::State state;\n    ${namespaceName}::Reset(state);\n    int callbackCount = 0;\n    const auto diagnostics = ${namespaceName}::Render(\n        state, {.onRendered = [&](const ${namespaceName}::Diagnostics&) { ++callbackCount; }});\n    studio::EndFrame(runtime);\n    ImGui::Render();\n    const bool valid = callbackCount == 1 && diagnostics.toggleBounds.widthPx == 58.0F;\n    ${namespaceName}::Shutdown();\n    ImGui::DestroyContext(imgui);\n    return valid ? 0 : 1;\n}\n`;
}

function nativeFixtureCmake(namespaceName: string): string {
  return `cmake_minimum_required(VERSION 3.25)\nproject(ImGuiStudioExportNative LANGUAGES CXX)\n\nif(NOT DEFINED IMGUI_SOURCE_DIR)\n    message(FATAL_ERROR "IMGUI_SOURCE_DIR must name a compatible Dear ImGui source directory")\nendif()\n\nadd_library(imgui_export_core STATIC\n    "\${IMGUI_SOURCE_DIR}/imgui.cpp"\n    "\${IMGUI_SOURCE_DIR}/imgui_draw.cpp"\n    "\${IMGUI_SOURCE_DIR}/imgui_tables.cpp"\n    "\${IMGUI_SOURCE_DIR}/imgui_widgets.cpp"\n)\ntarget_include_directories(imgui_export_core PUBLIC "\${IMGUI_SOURCE_DIR}")\ntarget_compile_features(imgui_export_core PUBLIC cxx_std_20)\nadd_library(DearImGui::Core ALIAS imgui_export_core)\n\nadd_library(imgui_export_native_backend STATIC\n    "\${IMGUI_SOURCE_DIR}/backends/imgui_impl_win32.cpp"\n    "\${IMGUI_SOURCE_DIR}/backends/imgui_impl_dx11.cpp"\n)\ntarget_include_directories(imgui_export_native_backend PUBLIC "\${IMGUI_SOURCE_DIR}")\ntarget_link_libraries(imgui_export_native_backend PUBLIC imgui_export_core d3d11 dxgi)\nadd_library(DearImGui::NativeBackend ALIAS imgui_export_native_backend)\n\nset(IMGUI_TARGET DearImGui::Core CACHE STRING "" FORCE)\nadd_subdirectory("\${CMAKE_CURRENT_LIST_DIR}/../.." export-package)\n\nadd_executable(imgui_studio_export_native main.cpp capture.cpp)\ntarget_compile_features(imgui_studio_export_native PRIVATE cxx_std_20)\ntarget_compile_definitions(imgui_studio_export_native PRIVATE NOMINMAX WIN32_LEAN_AND_MEAN)\ntarget_include_directories(imgui_studio_export_native PRIVATE "\${CMAKE_CURRENT_SOURCE_DIR}")\ntarget_link_libraries(imgui_studio_export_native PRIVATE DearImGui::NativeBackend ${namespaceName}::menu d3d11 dxgi ole32 windowscodecs)\nset_target_properties(imgui_studio_export_native PROPERTIES RUNTIME_OUTPUT_DIRECTORY "\${CMAKE_BINARY_DIR}/bin" RUNTIME_OUTPUT_DIRECTORY_DEBUG "\${CMAKE_BINARY_DIR}/bin" VS_GLOBAL_VcpkgEnabled false VS_GLOBAL_VcpkgAppLocalDeps false)\n\nadd_executable(imgui_studio_export_consumer_contract consumer_contract.cpp)\ntarget_compile_features(imgui_studio_export_consumer_contract PRIVATE cxx_std_20)\ntarget_link_libraries(imgui_studio_export_consumer_contract PRIVATE ${namespaceName}::menu)\nset_target_properties(imgui_studio_export_consumer_contract PROPERTIES RUNTIME_OUTPUT_DIRECTORY "\${CMAKE_BINARY_DIR}/bin" RUNTIME_OUTPUT_DIRECTORY_DEBUG "\${CMAKE_BINARY_DIR}/bin" VS_GLOBAL_VcpkgEnabled false VS_GLOBAL_VcpkgAppLocalDeps false)\n`;
}

async function verifyPackage(
  repositoryRoot: string,
  packageRoot: string,
  workRoot: string,
  previews: PreviewCoordinator,
  buildId: string,
  projectRevision: string,
  expectedStarterHash: string,
): Promise<{
  geometryMaximumDifferencePx: number;
  nativeMetadata: unknown;
  pixelDiagnostics: { meanAbsoluteChannelDifference: number; differingPixels: number };
}> {
  await mkdir(workRoot, { recursive: true });
  const buildDirectory = resolve(workRoot, 'build');
  await runProcess('cmake.exe', [
    '-S',
    resolve(packageRoot, 'examples/native'),
    '-B',
    buildDirectory,
    '-G',
    'Visual Studio 17 2022',
    '-A',
    'x64',
    `-DIMGUI_SOURCE_DIR=${resolve(repositoryRoot, '.tools/dependencies/dear-imgui')}`,
  ]);
  await runProcess('cmake.exe', [
    '--build',
    buildDirectory,
    '--config',
    'Debug',
    '--target',
    'imgui_studio_export_native',
    'imgui_studio_export_consumer_contract',
  ]);
  await runProcess(resolve(buildDirectory, 'bin/imgui_studio_export_consumer_contract.exe'), []);
  const executable = resolve(buildDirectory, 'bin/imgui_studio_export_native.exe');
  const nativePng = resolve(workRoot, 'native.png');
  const nativeMetadataPath = resolve(workRoot, 'native.metadata.json');
  await runProcess(executable, ['--output', nativePng, '--metadata', nativeMetadataPath]);

  const initial = await previews.load(buildId, false);
  const reset = await previews.reset(initial.identity.previewInstanceId, {
    buildId,
    projectRevision,
  });
  const browser = await previews.render(
    reset.identity.previewInstanceId,
    { buildId, projectRevision },
    nativeCaptureTimeUs,
    true,
  );
  if (!browser.imageArtifact) {
    throw new ServiceError(
      'EXPORT_VERIFICATION_FAILED',
      'Browser capture was not produced.',
      500,
      true,
    );
  }
  const browserBytes = await previews.readArtifact(browser.imageArtifact.artifactId);
  await writeFile(resolve(workRoot, 'browser.png'), browserBytes, { flag: 'wx' });
  const nativeMetadata = JSON.parse(await readFile(nativeMetadataPath, 'utf8')) as {
    sourceSha256?: unknown;
    toggle?: { xPx?: unknown; yPx?: unknown; widthPx?: unknown; heightPx?: unknown };
  };
  if (nativeMetadata.sourceSha256 !== expectedStarterHash) {
    throw new ServiceError(
      'EXPORT_VERIFICATION_FAILED',
      'The packaged native fixture did not compile the selected project source identity.',
      409,
      false,
    );
  }
  const browserBounds = browser.widgets[0]?.boundsPx;
  const nativeBounds = nativeMetadata.toggle;
  if (!browserBounds || !nativeBounds) {
    throw new ServiceError(
      'EXPORT_VERIFICATION_FAILED',
      'Parity geometry metadata is incomplete.',
      409,
      false,
    );
  }
  const differences = [
    Math.abs(browserBounds[0] - Number(nativeBounds.xPx)),
    Math.abs(browserBounds[1] - Number(nativeBounds.yPx)),
    Math.abs(browserBounds[2] - Number(nativeBounds.widthPx)),
    Math.abs(browserBounds[3] - Number(nativeBounds.heightPx)),
  ];
  const pixelDiagnostics = comparePng(browserBytes, await readFile(nativePng));
  return {
    geometryMaximumDifferencePx: Math.max(...differences),
    nativeMetadata,
    pixelDiagnostics,
  };
}

function comparePng(
  browserBytes: Buffer,
  nativeBytes: Buffer,
): {
  meanAbsoluteChannelDifference: number;
  differingPixels: number;
} {
  const browser = PNG.sync.read(browserBytes);
  const native = PNG.sync.read(nativeBytes);
  if (browser.width !== native.width || browser.height !== native.height) {
    throw new ServiceError(
      'EXPORT_VERIFICATION_FAILED',
      'Browser and packaged-native capture dimensions differ.',
      409,
      false,
    );
  }
  let absolute = 0;
  let differingPixels = 0;
  for (let offset = 0; offset < browser.data.length; offset += 4) {
    let pixelDiffers = false;
    for (let channel = 0; channel < 4; channel += 1) {
      const difference = Math.abs(
        browser.data.readUInt8(offset + channel) - native.data.readUInt8(offset + channel),
      );
      absolute += difference;
      pixelDiffers ||= difference !== 0;
    }
    if (pixelDiffers) differingPixels += 1;
  }
  return {
    meanAbsoluteChannelDifference: absolute / browser.data.length,
    differingPixels,
  };
}

async function runProcess(executable: string, arguments_: readonly string[]): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(executable, arguments_, {
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: sanitizedEnvironment(),
    });
    let output = '';
    const collect = (chunk: Buffer): void => {
      output = `${output}${chunk.toString('utf8')}`.slice(-32_768);
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolvePromise();
      else
        reject(
          new ServiceError(
            'EXPORT_VERIFICATION_FAILED',
            'The clean packaged-native verification command failed.',
            409,
            false,
            { exitCode: code, output: redactOutput(output) },
          ),
        );
    });
  });
}

function sanitizedEnvironment(): NodeJS.ProcessEnv {
  const allowed = [
    'SystemRoot',
    'WINDIR',
    'ComSpec',
    'PATHEXT',
    'TEMP',
    'TMP',
    'PATH',
    'USERPROFILE',
    'HOMEDRIVE',
    'HOMEPATH',
    'APPDATA',
    'LOCALAPPDATA',
    'PROCESSOR_ARCHITECTURE',
    'NUMBER_OF_PROCESSORS',
  ];
  return Object.fromEntries(
    allowed.flatMap((name) => (process.env[name] === undefined ? [] : [[name, process.env[name]]])),
  );
}

function redactOutput(output: string): string {
  const roots = [process.env.USERPROFILE, process.env.TEMP].filter(
    (value): value is string => typeof value === 'string',
  );
  return roots.reduce(
    (result, root) =>
      result.replaceAll(root, '<host>').replaceAll(root.replaceAll('\\', '/'), '<host>'),
    output,
  );
}

async function calculateStarterSourceHash(
  snapshotRoot: string,
  paths: readonly string[],
): Promise<string> {
  const entries: string[] = [];
  for (const path of [...paths].sort(comparePath)) {
    entries.push(`${path}:${sha256(await readFile(resolve(snapshotRoot, ...path.split('/'))))}\n`);
  }
  return sha256(entries.join(''));
}

async function scanPortability(packageRoot: string, paths: readonly string[]): Promise<string[]> {
  const warnings: string[] = [];
  for (const path of paths.filter(isCxx)) {
    const content = await readFile(resolve(packageRoot, ...path.split('/')), 'utf8');
    if (content.includes('imgui_internal.h')) warnings.push(`Direct imgui_internal.h use: ${path}`);
    if (/\b(?:d3d11|dxgi|imgui_impl_|emscripten|GLFW)\b/i.test(content)) {
      throw new ServiceError(
        'UNSUPPORTED_RENDERING_TIER',
        'Portable project source contains a backend-specific dependency.',
        400,
        false,
        { path },
      );
    }
  }
  return warnings.sort(comparePath);
}

function exportReport(
  record: ExportRecord,
  manifest: ProjectExportManifest,
  sourceDigest: string,
  assetDigest: string,
  assets: readonly AssetDeclaration[],
  portabilityWarnings: readonly string[],
  verification: {
    geometryMaximumDifferencePx: number | null;
    nativeMetadata: unknown;
    pixelDiagnostics: unknown;
  },
): Record<string, unknown> {
  return {
    schemaVersion: 1,
    project: { name: manifest.name, revision: record.projectRevision },
    buildId: record.buildId,
    sourceDigest: `sha256:${sourceDigest}`,
    assetDigest: `sha256:${assetDigest}`,
    studioRuntimeVersion: manifest.toolchain.studioRuntimeVersion,
    imgui: {
      version: manifest.toolchain.imguiVersion,
      directInternalUse: portabilityWarnings.filter((warning) =>
        warning.includes('imgui_internal.h'),
      ),
    },
    toolchainSetId: manifest.toolchain.versionSet,
    cppStandard: manifest.language.cppStandard,
    renderingTier: manifest.renderingTier,
    testedNativeTarget: 'windows-msvc-dx11',
    viewport: manifest.viewport,
    assets,
    warnings: record.warnings,
    verification: {
      status: verification.geometryMaximumDifferencePx === null ? 'not-requested' : 'passed',
      geometryMaximumDifferencePx: verification.geometryMaximumDifferencePx,
      pixelDiagnostics: verification.pixelDiagnostics,
      nativeMetadata: verification.nativeMetadata,
      report: 'verification/report.json',
    },
  };
}

async function writeChecksums(packageRoot: string): Promise<void> {
  const files = (await collectFiles(packageRoot)).filter((path) => path !== 'SHA256SUMS');
  const lines: string[] = [];
  for (const path of files) {
    lines.push(`${sha256(await readFile(resolve(packageRoot, ...path.split('/'))))}  ${path}`);
  }
  await writeAtomic(resolve(packageRoot, 'SHA256SUMS'), `${lines.join('\n')}\n`);
}

async function inventoryPackage(packageRoot: string): Promise<ExportFile[]> {
  const files = await collectFiles(packageRoot);
  let totalBytes = 0;
  const inventory: ExportFile[] = [];
  for (const path of files) {
    const bytes = await readFile(resolve(packageRoot, ...path.split('/')));
    totalBytes += bytes.byteLength;
    inventory.push({
      path,
      sha256: sha256(bytes),
      sizeBytes: bytes.byteLength,
      ownership:
        path.startsWith('generated/') || path.startsWith('studio_runtime/')
          ? 'studio-managed'
          : path.startsWith('include/') || path.startsWith('src/') || path.startsWith('assets/')
            ? 'user'
            : 'export-generated',
    });
  }
  if (inventory.length > maximumExportFiles || totalBytes > maximumExportBytes) {
    throw new ServiceError(
      'LIMIT_EXCEEDED',
      'The export package exceeds configured limits.',
      413,
      false,
    );
  }
  return inventory;
}

async function collectFiles(root: string, directory = ''): Promise<string[]> {
  const absolute = resolve(root, ...directory.split('/').filter(Boolean));
  const output: string[] = [];
  for (const entry of (await readdir(absolute, { withFileTypes: true })).sort((a, b) =>
    comparePath(a.name, b.name),
  )) {
    const logical = directory ? `${directory}/${entry.name}` : entry.name;
    const path = resolve(absolute, entry.name);
    const status = await lstat(path);
    if (status.isSymbolicLink()) {
      throw new ServiceError(
        'PATH_OUTSIDE_PROJECT',
        'Export output contains a linked path.',
        400,
        false,
      );
    }
    if (entry.isDirectory()) output.push(...(await collectFiles(root, logical)));
    else if (entry.isFile()) output.push(logical);
  }
  return output.sort(comparePath);
}

async function copyFileCreatingParent(source: string, destination: string): Promise<void> {
  const sourceStatus = await stat(source);
  if (!sourceStatus.isFile()) throw new Error('Expected a regular export source file.');
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(source, destination);
}

function isCxx(path: string): boolean {
  return /\.(?:c|cc|cpp|cxx|h|hh|hpp|hxx|inl)$/i.test(path);
}

function sanitizeIdentifier(projectKey: string): string {
  return projectKey.replaceAll('-', '_');
}

function comparePath(left: string, right: string): number {
  return Buffer.from(left).compare(Buffer.from(right));
}

function isPersistedExportRecord(
  value: unknown,
  expectedExportId: string,
  expectedProjectId: string,
): value is ExportRecord {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<ExportRecord>;
  return (
    candidate.schemaVersion === 1 &&
    candidate.exportId === expectedExportId &&
    candidate.projectId === expectedProjectId &&
    candidate.status === 'succeeded' &&
    typeof candidate.outputName === 'string' &&
    candidate.packageDirectory === `.studio/exports/${expectedExportId}/${candidate.outputName}` &&
    Array.isArray(candidate.files)
  );
}
