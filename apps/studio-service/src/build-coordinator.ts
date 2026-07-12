import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { copyFile, cp, mkdir, readFile, readdir, rm, stat } from 'node:fs/promises';
import { basename, relative, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { normalizeProjectPath, sha256, writeAtomic } from './filesystem.ts';
import type { ProjectService } from './project-service.ts';
import { ServiceError } from './service-error.ts';
import type { BuildDiagnostic, BuildInputManifest, BuildRecord, PreviewIdentity } from './types.ts';

const maximumRawLogBytes = 1024 * 1024;
const buildTimeoutMs = 120_000;

type SmokePreview = (artifactDirectory: string, buildId: string) => Promise<boolean>;

/** Coordinates one cancellable build at a time and promotes only smoke-passed immutable artifacts. */
export class BuildCoordinator {
  readonly #records = new Map<string, BuildRecord>();
  #active: {
    buildId: string;
    child: ChildProcessWithoutNullStreams | null;
    cancelled: boolean;
  } | null = null;
  #lastSourceDigest: string | null = null;
  #lastAssetDigest: string | null = null;

  public constructor(
    private readonly repositoryRoot: string,
    private readonly project: ProjectService,
    private readonly smokePreview: SmokePreview,
    private readonly onChange: (record: BuildRecord) => void = () => undefined,
    private readonly studioOrigin = 'http://127.0.0.1:4173',
    private readonly previewOrigin = 'http://127.0.0.1:4174',
  ) {}

  /** Rehydrates immutable terminal records so successful artifacts survive service restarts. */
  public async initialize(): Promise<void> {
    const buildsRoot = resolve(this.project.root, '.studio/builds');
    let latestSuccessful:
      { completedAt: string; sourceDigest: string; assetDigest: string } | undefined;
    let entries;
    try {
      entries = await readdir(buildsRoot, { withFileTypes: true });
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.startsWith('bld_')) continue;
      try {
        const record = JSON.parse(
          await readFile(resolve(buildsRoot, entry.name, 'build.json'), 'utf8'),
        ) as BuildRecord;
        if (!isTerminal(record.status) || record.buildId !== entry.name) continue;
        if (record.status === 'succeeded') {
          if (record.artifactDirectory === null) throw new Error('missing artifact directory');
          for (const [name, expectedDigest] of Object.entries(record.artifactSha256)) {
            const artifact = resolve(this.project.root, record.artifactDirectory, name);
            if (sha256(await readFile(artifact)) !== expectedDigest)
              throw new Error('artifact digest mismatch');
          }
          const input = JSON.parse(
            await readFile(resolve(buildsRoot, entry.name, 'input-manifest.json'), 'utf8'),
          ) as { sourceDigest?: unknown; assetDigest?: unknown };
          if (
            record.completedAt !== null &&
            typeof input.sourceDigest === 'string' &&
            typeof input.assetDigest === 'string' &&
            (latestSuccessful === undefined || record.completedAt > latestSuccessful.completedAt)
          ) {
            latestSuccessful = {
              completedAt: record.completedAt,
              sourceDigest: input.sourceDigest,
              assetDigest: input.assetDigest,
            };
          }
        }
        this.#records.set(record.buildId, record);
      } catch {
        // Incomplete/corrupt records are not authoritative and are never exposed as successful.
        // Their directories remain for manual diagnosis; a new build creates an independent ID.
      }
    }
    if (latestSuccessful) {
      this.#lastSourceDigest = latestSuccessful.sourceDigest;
      this.#lastAssetDigest = latestSuccessful.assetDigest;
    }
  }

  /** Snapshots the current revision and queues its build without blocking the HTTP request. */
  public async start(expectedRevision: unknown): Promise<BuildRecord> {
    if (expectedRevision !== this.project.currentRevision) {
      throw new ServiceError(
        'REVISION_CONFLICT',
        'The requested build revision is stale.',
        409,
        true,
        {
          expectedRevision,
          currentRevision: this.project.currentRevision,
        },
      );
    }
    if (this.#active !== null) {
      throw new ServiceError(
        'BUILD_ALREADY_RUNNING',
        'A build is already active for this project.',
        409,
        true,
        {
          buildId: this.#active.buildId,
        },
      );
    }

    // Asset validation belongs immediately before immutable snapshotting. This keeps a failed
    // asset edit from replacing the last known-good preview and gives the caller a stable
    // `ASSET_INVALID` error instead of a late compiler or browser-host failure.
    await this.project.validateAssets();

    const buildId = `bld_${randomUUID()}`;
    const buildRoot = resolve(this.project.root, `.studio/builds/${buildId}`);
    const snapshotStart = performance.now();
    const snapshot = await this.project.createBuildSnapshot(resolve(buildRoot, 'snapshot'));
    const record: BuildRecord = {
      schemaVersion: 1,
      buildId,
      projectId: this.project.projectId,
      projectRevision: snapshot.revision,
      configuration: 'preview-debug',
      status: 'queued',
      toolchainVersionSet: String(
        (this.project.manifest.toolchain as Record<string, unknown>).versionSet,
      ),
      startedAt: null,
      completedAt: null,
      smokePassed: null,
      diagnostics: [],
      rawLog: '',
      artifactDirectory: null,
      artifactSha256: {},
      artifactSizeBytes: {},
      phaseDurationsMs: { snapshot: performance.now() - snapshotStart },
      cache: {
        projectSourcesChanged: this.#lastSourceDigest !== snapshot.sourceDigest,
        stableObjectsReused: this.#lastSourceDigest !== null,
        corruptionRecovered: false,
        assetBundleReused: this.#lastAssetDigest === snapshot.assetDigest,
      },
    };
    await writeAtomic(
      resolve(buildRoot, 'input-manifest.json'),
      `${JSON.stringify(snapshot, null, 2)}\n`,
    );
    this.#records.set(buildId, record);
    this.#active = { buildId, child: null, cancelled: false };
    this.onChange(structuredClone(record));
    void this.#run(record, buildRoot, snapshot.sourceDigest, snapshot.assetDigest);
    return structuredClone(record);
  }

  /** Returns an isolated copy so callers cannot mutate authoritative build state. */
  public get(buildId: string): BuildRecord {
    const record = this.#records.get(buildId);
    if (!record) {
      throw new ServiceError('BUILD_NOT_FOUND', 'The requested build does not exist.', 404, false);
    }
    return structuredClone(record);
  }

  /**
   * Resolves and re-verifies the immutable inputs of a successful build for export.
   *
   * Exporters receive the build-owned snapshot rather than the mutable project root. Every
   * recorded source byte and preview artifact is hashed again so post-build tampering fails closed
   * before packaging begins.
   */
  public async resolveSuccessfulInput(buildId: string): Promise<{
    record: BuildRecord;
    input: BuildInputManifest;
    snapshotDirectory: string;
  }> {
    const record = this.#records.get(buildId);
    if (!record) {
      throw new ServiceError(
        'EXPORT_REQUIRES_SUCCESSFUL_BUILD',
        'Only a smoke-passed successful build can be exported.',
        409,
        false,
      );
    }
    if (
      record.status !== 'succeeded' ||
      record.smokePassed !== true ||
      record.artifactDirectory === null
    ) {
      throw new ServiceError(
        'EXPORT_REQUIRES_SUCCESSFUL_BUILD',
        'Only a smoke-passed successful build can be exported.',
        409,
        false,
      );
    }
    const buildRoot = resolve(this.project.root, `.studio/builds/${buildId}`);
    let parsedInput: unknown;
    try {
      parsedInput = JSON.parse(
        await readFile(resolve(buildRoot, 'input-manifest.json'), 'utf8'),
      ) as unknown;
    } catch {
      throw new ServiceError(
        'EXPORT_REQUIRES_SUCCESSFUL_BUILD',
        'The selected build input record is missing or malformed.',
        409,
        false,
      );
    }
    if (!isBuildInputManifest(parsedInput) || parsedInput.revision !== record.projectRevision) {
      throw new ServiceError(
        'EXPORT_REQUIRES_SUCCESSFUL_BUILD',
        'The selected build input identity is inconsistent.',
        409,
        false,
      );
    }
    const input = parsedInput;
    const snapshotDirectory = resolve(buildRoot, 'snapshot');
    for (const file of input.files) {
      const normalized = normalizeProjectPath(file.path);
      const bytes = await readFile(resolve(snapshotDirectory, ...normalized.split('/')));
      if (sha256(bytes) !== file.sha256 || bytes.byteLength !== file.sizeBytes) {
        throw new ServiceError(
          'EXPORT_REQUIRES_SUCCESSFUL_BUILD',
          'A selected build input failed digest verification.',
          409,
          false,
          { path: normalized },
        );
      }
    }
    for (const [name, digest] of Object.entries(record.artifactSha256)) {
      const artifact = resolve(this.project.root, record.artifactDirectory, name);
      if (sha256(await readFile(artifact)) !== digest) {
        throw new ServiceError(
          'EXPORT_REQUIRES_SUCCESSFUL_BUILD',
          'A selected preview artifact failed digest verification.',
          409,
          false,
          { artifact: name },
        );
      }
    }
    return { record: structuredClone(record), input, snapshotDirectory };
  }

  /** Requests terminal cancellation and kills the owned process tree when one is running. */
  public async cancel(buildId: string): Promise<BuildRecord> {
    const record = this.#records.get(buildId);
    if (!record) {
      throw new ServiceError('BUILD_NOT_FOUND', 'The requested build does not exist.', 404, false);
    }
    if (isTerminal(record.status)) {
      return structuredClone(record);
    }
    if (this.#active?.buildId === buildId) {
      this.#active.cancelled = true;
      if (this.#active.child?.pid) {
        await terminateProcessTree(this.#active.child.pid);
      }
    }
    return structuredClone(record);
  }

  /** Resolves an artifact request only for a successful build owned by this coordinator. */
  public artifactPath(buildId: string, name: string): string {
    const record = this.#records.get(buildId);
    if (
      !record ||
      (record.status !== 'running' && record.status !== 'succeeded') ||
      record.artifactDirectory === null
    ) {
      throw new ServiceError(
        'BUILD_NOT_FOUND',
        'The requested preview artifact is unavailable.',
        404,
        false,
      );
    }
    if (!['preview.html', 'preview.js', 'preview.wasm'].includes(name)) {
      throw new ServiceError(
        'FILE_NOT_FOUND',
        'The requested preview artifact does not exist.',
        404,
        false,
      );
    }
    return resolve(this.project.root, record.artifactDirectory, name);
  }

  async #run(
    record: BuildRecord,
    buildRoot: string,
    sourceDigest: string,
    assetDigest: string,
  ): Promise<void> {
    const active = this.#active;
    if (active?.buildId !== record.buildId) return;
    record.status = 'running';
    record.startedAt = new Date().toISOString();
    this.onChange(structuredClone(record));
    if (active.cancelled) {
      await this.#finishCancelled(record, buildRoot);
      record.completedAt = new Date().toISOString();
      await this.#persistRecord(record, buildRoot);
      this.onChange(structuredClone(record));
      if (this.#active?.buildId === record.buildId) this.#active = null;
      return;
    }
    const compileStart = performance.now();
    try {
      const sharedBuildDirectory = resolve(
        this.repositoryRoot,
        `build/service/${this.project.projectId}`,
      );
      record.cache.corruptionRecovered = await verifyStableObjectCache(sharedBuildDirectory);
      await updateAssetBundleCache(sharedBuildDirectory, assetDigest);
      const stableProjectInput = resolve(sharedBuildDirectory, 'project-input');
      await rm(stableProjectInput, { recursive: true, force: true });
      await cp(resolve(buildRoot, 'snapshot'), stableProjectInput, { recursive: true });
      const script = resolve(this.repositoryRoot, 'toolchain/emscripten/service-build.ps1');
      const result = await this.#spawnBounded(record, 'powershell.exe', [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        script,
        '-BuildDirectory',
        sharedBuildDirectory,
        '-StarterSourceDirectory',
        stableProjectInput,
      ]);
      record.phaseDurationsMs = {
        ...record.phaseDurationsMs,
        compileAndLink: performance.now() - compileStart,
        ...parseWorkerPhaseDurations(result.output),
      };
      if (this.#wasCancelled(record.buildId)) {
        await this.#finishCancelled(record, buildRoot);
        return;
      }
      if (result.exitCode !== 0) {
        record.status = 'failed';
        record.diagnostics = parseDiagnostics(result.output, record.buildId, [
          this.repositoryRoot,
          this.project.root,
          buildRoot,
        ]);
        record.smokePassed = false;
        return;
      }

      await recordStableObjectCache(sharedBuildDirectory);

      const artifactStart = performance.now();
      const generatedDirectory = resolve(sharedBuildDirectory, 'preview');
      const artifactDirectory = resolve(buildRoot, 'artifacts');
      await mkdir(artifactDirectory, { recursive: true });
      const artifactSha256: Record<string, string> = {};
      const artifactSizeBytes: Record<string, number> = {};
      for (const name of ['preview.html', 'preview.js', 'preview.wasm']) {
        const source = resolve(generatedDirectory, name);
        const sourceStatus = await stat(source);
        if (!sourceStatus.isFile() || sourceStatus.size === 0) {
          throw new Error(`Missing generated artifact ${name}`);
        }
        const destination = resolve(artifactDirectory, name);
        await copyFile(source, destination);
        artifactSha256[name] = sha256(await readFile(destination));
        artifactSizeBytes[name] = sourceStatus.size;
      }
      record.artifactDirectory = relative(this.project.root, artifactDirectory).replaceAll(
        '\\',
        '/',
      );
      record.artifactSha256 = artifactSha256;
      record.artifactSizeBytes = artifactSizeBytes;
      record.phaseDurationsMs = {
        ...record.phaseDurationsMs,
        artifactPromotion: performance.now() - artifactStart,
      };

      const smokeStart = performance.now();
      record.smokePassed = await this.smokePreview(artifactDirectory, record.buildId);
      record.phaseDurationsMs = {
        ...record.phaseDurationsMs,
        smoke: performance.now() - smokeStart,
      };
      if (!record.smokePassed) {
        record.status = 'failed';
        record.diagnostics.push({
          severity: 'error',
          code: 'PREVIEW_SMOKE_FAILED',
          message: 'The generated preview did not reach the ready lifecycle state.',
          relativePath: null,
          line: null,
          column: null,
          buildId: record.buildId,
        });
        return;
      }

      record.status = 'succeeded';
      this.#lastSourceDigest = sourceDigest;
      this.#lastAssetDigest = assetDigest;
      const previewInstanceId = `prv_${randomUUID()}`;
      const preview: PreviewIdentity = {
        previewInstanceId,
        buildId: record.buildId,
        projectRevision: record.projectRevision,
        runtimeProtocolVersion: 1,
        url:
          `${this.previewOrigin}/builds/${record.buildId}/preview.html` +
          `?parentOrigin=${encodeURIComponent(this.studioOrigin)}` +
          `&projectId=${encodeURIComponent(this.project.projectId)}` +
          `&projectRevision=${encodeURIComponent(record.projectRevision)}` +
          `&buildId=${encodeURIComponent(record.buildId)}` +
          `&previewInstanceId=${encodeURIComponent(previewInstanceId)}`,
      };
      await this.project.promoteBuild(record.buildId, preview);
    } catch (error) {
      if (this.#wasCancelled(record.buildId)) {
        await this.#finishCancelled(record, buildRoot);
        return;
      }
      record.status = 'failed';
      record.smokePassed = false;
      record.diagnostics.push({
        severity: 'fatal',
        code: 'BUILD_WORKER_FAILED',
        message:
          error instanceof Error
            ? sanitizeText(error.message, [this.repositoryRoot, this.project.root])
            : 'Build worker failed.',
        relativePath: null,
        line: null,
        column: null,
        buildId: record.buildId,
      });
    } finally {
      record.completedAt = new Date().toISOString();
      await this.#persistRecord(record, buildRoot);
      this.onChange(structuredClone(record));
      if (this.#active?.buildId === record.buildId) this.#active = null;
    }
  }

  async #spawnBounded(
    record: BuildRecord,
    executable: string,
    arguments_: readonly string[],
  ): Promise<{ exitCode: number; output: string }> {
    return new Promise((resolvePromise, reject) => {
      const child = spawn(executable, arguments_, {
        cwd: this.project.root,
        env: sanitizedEnvironment(),
        shell: false,
        windowsHide: true,
      });
      if (this.#active?.buildId === record.buildId) this.#active.child = child;
      const chunks: Buffer[] = [];
      let size = 0;
      const collect = (chunk: Buffer): void => {
        if (size >= maximumRawLogBytes) return;
        const remaining = maximumRawLogBytes - size;
        const bounded = chunk.subarray(0, remaining);
        chunks.push(bounded);
        size += bounded.length;
      };
      child.stdout.on('data', collect);
      child.stderr.on('data', collect);
      child.on('error', reject);
      const timeout = setTimeout(() => {
        if (child.pid) void terminateProcessTree(child.pid);
      }, buildTimeoutMs);
      child.on('close', (code) => {
        clearTimeout(timeout);
        const output = sanitizeText(Buffer.concat(chunks).toString('utf8'), [
          this.repositoryRoot,
          this.project.root,
        ]);
        record.rawLog = output;
        resolvePromise({ exitCode: code ?? 1, output });
      });
    });
  }

  async #finishCancelled(record: BuildRecord, buildRoot: string): Promise<void> {
    record.status = 'cancelled';
    record.smokePassed = false;
    record.artifactDirectory = null;
    record.artifactSha256 = {};
    record.artifactSizeBytes = {};
    await rm(resolve(buildRoot, 'artifacts'), { recursive: true, force: true });
  }

  async #persistRecord(record: BuildRecord, buildRoot: string): Promise<void> {
    await writeAtomic(resolve(buildRoot, 'build.json'), `${JSON.stringify(record, null, 2)}\n`);
  }

  #wasCancelled(buildId: string): boolean {
    return this.#active?.buildId === buildId && this.#active.cancelled;
  }
}

function isBuildInputManifest(value: unknown): value is BuildInputManifest {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.revision !== 'string' ||
    typeof candidate.sourceDigest !== 'string' ||
    !/^[a-f0-9]{64}$/.test(candidate.sourceDigest) ||
    typeof candidate.assetDigest !== 'string' ||
    !/^[a-f0-9]{64}$/.test(candidate.assetDigest) ||
    !Array.isArray(candidate.files)
  ) {
    return false;
  }
  return candidate.files.every((file) => {
    if (file === null || typeof file !== 'object' || Array.isArray(file)) return false;
    const entry = file as Record<string, unknown>;
    return (
      typeof entry.path === 'string' &&
      typeof entry.sha256 === 'string' &&
      /^[a-f0-9]{64}$/.test(entry.sha256) &&
      Number.isSafeInteger(entry.sizeBytes) &&
      (entry.sizeBytes as number) >= 0
    );
  });
}

function parseDiagnostics(
  output: string,
  buildId: string,
  redactions: readonly string[],
): BuildDiagnostic[] {
  const diagnostics: BuildDiagnostic[] = [];
  const clangPattern = /^(.*?):(\d+):(\d+):\s+(warning|error|fatal error|note):\s+(.*)$/gm;
  for (const match of output.matchAll(clangPattern)) {
    const message = match[5];
    const path = match[1];
    if (message === undefined || path === undefined) continue;
    diagnostics.push({
      severity: match[4] === 'fatal error' ? 'fatal' : (match[4] as BuildDiagnostic['severity']),
      code: 'COMPILER',
      message: sanitizeText(message, redactions),
      relativePath: sanitizeRelativePath(path, redactions),
      line: Number(match[2]),
      column: Number(match[3]),
      buildId,
    });
    if (diagnostics.length === 128) break;
  }
  if (diagnostics.length === 0) {
    diagnostics.push({
      severity: 'error',
      code: 'BUILD_FAILED',
      message: 'The compiler or linker failed. See the bounded build log for details.',
      relativePath: null,
      line: null,
      column: null,
      buildId,
    });
  }
  return diagnostics;
}

function parseWorkerPhaseDurations(output: string): Record<string, number> {
  const phases: Record<string, number> = {};
  const pattern = /^\[STUDIO_PHASE\] (configure|compile|link)Ms=([0-9]+(?:\.[0-9]+)?)$/gm;
  for (const match of output.matchAll(pattern)) {
    const phase = match[1];
    const duration = Number(match[2]);
    if (phase !== undefined && Number.isFinite(duration)) phases[phase] = duration;
  }
  return phases;
}

function sanitizeRelativePath(path: string, redactions: readonly string[]): string | null {
  const sanitized = sanitizeText(path, redactions).replaceAll('\\', '/');
  for (const marker of ['snapshot/', 'project-input/']) {
    const index = sanitized.lastIndexOf(marker);
    if (index >= 0) return sanitized.slice(index + marker.length);
  }
  return basename(sanitized);
}

function sanitizeText(text: string, redactions: readonly string[]): string {
  let sanitized = text;
  for (const path of [...redactions, ...sensitiveHostRoots()]) {
    sanitized = sanitized
      .replaceAll(path, '<workspace>')
      .replaceAll(path.replaceAll('\\', '/'), '<workspace>');
  }
  return sanitized.slice(0, maximumRawLogBytes);
}

function sensitiveHostRoots(): string[] {
  const names = [
    'USERPROFILE',
    'ProgramFiles',
    'ProgramFiles(x86)',
    'LOCALAPPDATA',
    'APPDATA',
    'TEMP',
    'SystemRoot',
  ];
  return names.flatMap((name) => {
    const value = process.env[name];
    return value === undefined ? [] : [value];
  });
}

function sanitizedEnvironment(): NodeJS.ProcessEnv {
  // Windows command discovery and Emscripten's Python/Node launchers require a small amount of host
  // profile metadata in addition to the compiler environment. Credentials, proxies, SSH agents,
  // cloud variables, and arbitrary user-defined values remain excluded.
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
    'INCLUDE',
    'LIB',
    'LIBPATH',
    'EMSDK',
    'EMSDK_NODE',
    'EMSDK_PYTHON',
  ];
  return Object.fromEntries(
    allowed.flatMap((name) => (process.env[name] === undefined ? [] : [[name, process.env[name]]])),
  );
}

async function terminateProcessTree(processId: number): Promise<void> {
  if (process.platform === 'win32') {
    await new Promise<void>((resolvePromise) => {
      const killer = spawn('taskkill.exe', ['/PID', String(processId), '/T', '/F'], {
        shell: false,
        windowsHide: true,
        stdio: 'ignore',
      });
      killer.on('close', () => resolvePromise());
      killer.on('error', () => resolvePromise());
    });
  } else {
    try {
      process.kill(-processId, 'SIGTERM');
    } catch {
      // The process may already have reached a terminal state; cancellation is idempotent.
    }
  }
}

function isTerminal(status: BuildRecord['status']): boolean {
  return status === 'succeeded' || status === 'failed' || status === 'cancelled';
}

interface StableCacheManifest {
  readonly schemaVersion: 1;
  readonly files: Readonly<Record<string, string>>;
}

async function verifyStableObjectCache(buildDirectory: string): Promise<boolean> {
  const manifestPath = resolve(buildDirectory, '.studio-stable-cache.json');
  let manifest: StableCacheManifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as StableCacheManifest;
  } catch {
    return false;
  }
  let recovered = false;
  for (const [relativePath, expectedDigest] of Object.entries(manifest.files)) {
    const path = resolve(buildDirectory, relativePath);
    try {
      if (sha256(await readFile(path)) !== expectedDigest) {
        await rm(path, { force: true });
        recovered = true;
      }
    } catch {
      // A missing object is already a cache miss and CMake will rebuild it; no extra eviction is
      // required. Only a present object with a wrong digest is classified as corruption recovery.
    }
  }
  return recovered;
}

async function recordStableObjectCache(buildDirectory: string): Promise<void> {
  const files: Record<string, string> = {};
  await collectStableObjects(buildDirectory, buildDirectory, files);
  await writeAtomic(
    resolve(buildDirectory, '.studio-stable-cache.json'),
    `${JSON.stringify({ schemaVersion: 1, files }, null, 2)}\n`,
  );
}

async function updateAssetBundleCache(buildDirectory: string, assetDigest: string): Promise<void> {
  const bundlePath = resolve(buildDirectory, '.studio-asset-bundle.json');
  try {
    const current = JSON.parse(await readFile(bundlePath, 'utf8')) as { assetDigest?: unknown };
    if (current.assetDigest === assetDigest) return;
  } catch {
    // Missing/malformed bundle metadata is a scoped cache miss. Regeneration below is deterministic.
  }
  await writeAtomic(bundlePath, `${JSON.stringify({ schemaVersion: 1, assetDigest }, null, 2)}\n`);
}

async function collectStableObjects(
  buildDirectory: string,
  directory: string,
  output: Record<string, string>,
): Promise<void> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      await collectStableObjects(buildDirectory, path, output);
      continue;
    }
    const protocolPath = relative(buildDirectory, path).replaceAll('\\', '/');
    if (
      /(?:dear_imgui_core|dear_imgui_browser_backend)\.dir\//.test(protocolPath) &&
      /\.(?:o|obj)$/i.test(entry.name)
    ) {
      output[protocolPath] = sha256(await readFile(path));
    }
  }
}
