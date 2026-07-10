import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { StudioHttpServer } from '../../apps/studio-service/src/http-server.ts';
import { ProjectService } from '../../apps/studio-service/src/project-service.ts';
import type {
  BuildRecord,
  ProjectFile,
  ProjectSnapshot,
} from '../../apps/studio-service/src/types.ts';

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
const outputRoot = resolve(repositoryRoot, 'out/phase2-integration');
const projectRoot = resolve(outputRoot, 'project');
const studioPort = 4373;
const previewPort = 4374;

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });
await cp(resolve(repositoryRoot, 'examples/starter'), projectRoot, {
  recursive: true,
  filter: (source) => !source.includes(resolve(repositoryRoot, 'examples/starter/.studio')),
});
await rm(resolve(projectRoot, '.studio'), { recursive: true, force: true });

const project = await ProjectService.open(projectRoot, repositoryRoot);
const server = new StudioHttpServer(repositoryRoot, project, { studioPort, previewPort });
const { token } = await server.listen();

try {
  const firstBuild = await startAndWaitBuild('0');
  assert(firstBuild.status === 'succeeded', 'Initial build did not succeed.');
  assert(firstBuild.smokePassed, 'Initial build did not pass real browser smoke initialization.');
  const initialSnapshot = await request<ProjectSnapshot>(`/api/v1/projects/${project.projectId}`);
  const initialPreview = initialSnapshot.currentPreview;
  assert(initialPreview?.buildId === firstBuild.buildId, 'Initial preview was not promoted.');

  // Corrupt one stable Dear ImGui/backend object. The next build must detect its digest mismatch,
  // evict only that object, and let CMake regenerate it instead of trusting poisoned cache bytes.
  const cacheManifestPath = resolve(
    repositoryRoot,
    `build/service/${project.projectId}/.studio-stable-cache.json`,
  );
  const cacheManifest = JSON.parse(await readFile(cacheManifestPath, 'utf8')) as {
    files: Record<string, string>;
  };
  const stableObject = Object.keys(cacheManifest.files)[0];
  assert(stableObject, 'Stable object cache manifest was empty.');
  await writeFile(resolve(dirname(cacheManifestPath), stableObject), 'corrupted-cache-entry');

  const validFile = await readSource('src/menu.cpp', '0');
  const brokenSource = validFile.content.replace(
    'constexpr float kAnimationResponse = 13.0F;',
    'constexpr float kAnimationResponse = ;',
  );
  await patchSource(validFile, brokenSource, '0');
  const failedBuild = await startAndWaitBuild('1');
  assert(failedBuild.status === 'failed', 'Compiler-error fixture unexpectedly succeeded.');
  assert(
    failedBuild.diagnostics.length > 0,
    'Compiler failure did not return structured diagnostics.',
  );
  const compilerDiagnostic = failedBuild.diagnostics[0];
  assert(
    compilerDiagnostic?.relativePath === 'src/menu.cpp',
    'Compiler diagnostic path was not project-relative.',
  );
  assert(
    compilerDiagnostic.line !== null && compilerDiagnostic.column !== null,
    'Compiler diagnostic omitted its source location.',
  );
  const failedLog = await request<{ rawLog: string }>(
    `/api/v1/projects/${project.projectId}/builds/${failedBuild.buildId}/log`,
    { authenticated: true },
  );
  assert(!failedLog.rawLog.includes(repositoryRoot), 'Build log exposed the repository host path.');
  assert(
    !failedLog.rawLog.includes(process.env.USERPROFILE ?? '__missing_profile__'),
    'Build log exposed the user profile path.',
  );
  assert(
    failedBuild.cache.corruptionRecovered,
    'Corrupted stable cache object was not detected and evicted.',
  );
  const failedSnapshot = await request<ProjectSnapshot>(`/api/v1/projects/${project.projectId}`);
  const retainedPreview = failedSnapshot.currentPreview;
  assert(retainedPreview !== null, 'Failed build removed the last known-good preview.');
  assert(
    failedSnapshot.lastSuccessfulBuildId === firstBuild.buildId,
    'Failed build replaced lastSuccessfulBuild.',
  );
  assert(
    retainedPreview.previewInstanceId === initialPreview.previewInstanceId,
    'Failed build replaced the last known-good preview.',
  );
  assert(
    failedSnapshot.currentRevision === '1',
    'Broken source revision was not retained for editing.',
  );

  const brokenFile = await readSource('src/menu.cpp', '1');
  const repairedSource = brokenFile.content.replace(
    'constexpr float kAnimationResponse = ;',
    'constexpr float kAnimationResponse = 14.0F;',
  );
  await patchSource(brokenFile, repairedSource, '1');
  const replacementBuild = await startAndWaitBuild('2');
  assert(replacementBuild.status === 'succeeded', 'Repaired one-file build did not succeed.');
  assert(replacementBuild.cache.stableObjectsReused, 'Warm build did not reuse stable objects.');
  assert(
    replacementBuild.cache.assetBundleReused,
    'Unchanged asset inputs regenerated the asset bundle.',
  );
  const finalSnapshot = await request<ProjectSnapshot>(`/api/v1/projects/${project.projectId}`);
  const replacementPreview = finalSnapshot.currentPreview;
  assert(replacementPreview !== null, 'Successful build did not promote a replacement preview.');
  assert(replacementPreview.projectRevision === '2', 'Replacement preview has wrong revision.');
  assert(
    replacementPreview.previewInstanceId !== initialPreview.previewInstanceId,
    'Successful replacement reused the previous preview instance.',
  );

  const queuedCancellation = await request<{ build: PublicBuild }>(
    `/api/v1/projects/${project.projectId}/builds`,
    {
      method: 'POST',
      mutation: true,
      body: { expectedRevision: '2', configuration: 'preview-debug', supersedeQueued: true },
    },
  );
  await request<unknown>(
    `/api/v1/projects/${project.projectId}/builds/${queuedCancellation.build.buildId}:cancel`,
    { method: 'POST', mutation: true },
  );
  const cancelledBuild = await waitForBuild(queuedCancellation.build);
  assert(cancelledBuild.status === 'cancelled', 'Cancellation did not reach a terminal record.');
  const afterCancellation = await request<ProjectSnapshot>(`/api/v1/projects/${project.projectId}`);
  assert(
    afterCancellation.lastSuccessfulBuildId === replacementBuild.buildId,
    'Cancelled build replaced lastSuccessfulBuild.',
  );

  const report = {
    schemaVersion: 1,
    initialBuildId: firstBuild.buildId,
    failedBuildId: failedBuild.buildId,
    replacementBuildId: replacementBuild.buildId,
    cancelledBuildId: cancelledBuild.buildId,
    lastKnownGoodRetainedAfterFailure: true,
    cacheCorruptionRecovered: true,
    stableObjectsReused: true,
    assetBundleReused: true,
    phaseDurationsMs: {
      initial: firstBuild.phaseDurationsMs,
      failed: failedBuild.phaseDurationsMs,
      replacement: replacementBuild.phaseDurationsMs,
    },
  };
  await writeFile(resolve(outputRoot, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log('Phase 2 revision → cached build → smoke → preview replacement gate passed.');
} finally {
  await server.close();
}

type PublicBuild = Omit<BuildRecord, 'artifactDirectory'>;
type SourceFile = ProjectFile & { content: string; revision: string };

async function startAndWaitBuild(expectedRevision: string): Promise<PublicBuild> {
  const start = await request<{ build: PublicBuild }>(
    `/api/v1/projects/${project.projectId}/builds`,
    {
      method: 'POST',
      mutation: true,
      body: { expectedRevision, configuration: 'preview-debug', supersedeQueued: true },
    },
  );
  return waitForBuild(start.build);
}

async function waitForBuild(initial: PublicBuild): Promise<PublicBuild> {
  let build = initial;
  const deadline = Date.now() + 180_000;
  while (!['succeeded', 'failed', 'cancelled'].includes(build.status)) {
    if (Date.now() > deadline) {
      throw new Error(`Build ${build.buildId} exceeded integration timeout.`);
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 200));
    ({ build } = await request<{ build: PublicBuild }>(
      `/api/v1/projects/${project.projectId}/builds/${build.buildId}`,
    ));
  }
  return build;
}

async function readSource(path: string, expectedRevision: string): Promise<SourceFile> {
  const result = await request<{ files: SourceFile[] }>(
    `/api/v1/projects/${project.projectId}/files:read`,
    {
      method: 'POST',
      body: { paths: [path], expectedRevision },
    },
  );
  const file = result.files[0];
  if (file === undefined) throw new Error('Source read returned no file.');
  return file;
}

async function patchSource(
  file: SourceFile,
  content: string,
  expectedRevision: string,
): Promise<void> {
  await request<unknown>(`/api/v1/projects/${project.projectId}/files:patch`, {
    method: 'POST',
    mutation: true,
    body: {
      expectedRevision,
      patches: [
        {
          path: file.path,
          expectedSha256: file.sha256,
          unifiedDiff: singleLineReplacementDiff(file.path, file.content, content),
        },
      ],
      reason: 'Phase 2 build integration fixture',
    },
  });
}

async function request<T>(
  path: string,
  options: { method?: string; mutation?: boolean; authenticated?: boolean; body?: unknown } = {},
): Promise<T> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'X-Studio-Client': 'agent-v1',
  };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.mutation || options.authenticated) {
    headers.Authorization = `Bearer ${token}`;
  }
  if (options.mutation) {
    headers['Idempotency-Key'] = crypto.randomUUID();
  }
  const requestInit: RequestInit = {
    method: options.method ?? 'GET',
    headers,
  };
  if (options.body !== undefined) requestInit.body = JSON.stringify(options.body);
  const response = await fetch(`http://127.0.0.1:${String(studioPort)}${path}`, requestInit);
  const body: unknown = await response.json();
  if (!response.ok) {
    const error = asRecord(asRecord(body).error);
    throw new Error(`${asString(error.code)}: ${asString(error.message)}`);
  }
  return body as T;
}

function singleLineReplacementDiff(path: string, before: string, after: string): string {
  const oldLines = logicalLines(before);
  const newLines = logicalLines(after);
  if (oldLines.length !== newLines.length)
    throw new Error('Fixture expected a one-line replacement.');
  const changedIndexes = oldLines.flatMap((line, index) =>
    line === newLines[index] ? [] : [index],
  );
  if (changedIndexes.length !== 1) throw new Error('Fixture expected exactly one changed line.');
  const index = changedIndexes[0];
  if (index === undefined) throw new Error('Changed line index is missing.');
  const oldLine = oldLines[index];
  const newLine = newLines[index];
  if (oldLine === undefined || newLine === undefined)
    throw new Error('Changed line content is missing.');
  const lineNumber = String(index + 1);
  return `--- a/${path}\n+++ b/${path}\n@@ -${lineNumber},1 +${lineNumber},1 @@\n-${oldLine}\n+${newLine}\n`;
}

function logicalLines(content: string): string[] {
  const normalized = content.replaceAll('\r\n', '\n').replace(/\n$/, '');
  return normalized.length === 0 ? [] : normalized.split('\n');
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Expected an object response.');
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Expected a string response field.');
  return value;
}
