import { randomUUID } from 'node:crypto';
import { copyFile, lstat, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { Ajv2020, type ValidateFunction } from 'ajv/dist/2020.js';
import { applyUnifiedDiff } from './unified-diff.ts';
import {
  canonicalizeRoot,
  normalizeProjectPath,
  readUtf8File,
  resolveConfinedPath,
  sha256,
  writeAtomic,
} from './filesystem.ts';
import { ServiceError } from './service-error.ts';
import type {
  PatchResult,
  PreviewIdentity,
  ProjectFile,
  ProjectSnapshot,
  SourcePatch,
} from './types.ts';

const maximumSourceBytes = 1024 * 1024;
const maximumPatchCount = 32;
const maximumIndexedFiles = 2048;

interface PersistedProjectState {
  schemaVersion: number;
  revision: string;
  lastSuccessfulBuildId: string | null;
  currentPreview: PreviewIdentity | null;
  revisions: {
    revision: string;
    changedPaths: string[];
    postimageSha256: Record<string, string | null>;
    committedAt: string;
  }[];
}

/** Canonical authority for one discovered project, its files, and monotonic revision. */
export class ProjectService {
  readonly #serial = new SerialQueue();
  readonly #manifestValidator: ValidateFunction;
  #state!: PersistedProjectState;
  #manifest!: Record<string, unknown>;

  private constructor(
    public readonly projectId: string,
    public readonly root: string,
    manifestValidator: ValidateFunction,
  ) {
    this.#manifestValidator = manifestValidator;
  }

  /** Opens and validates a project root without mutating canonical project content. */
  public static async open(root: string, repositoryRoot: string): Promise<ProjectService> {
    const canonicalRoot = await canonicalizeRoot(root);
    const schema = JSON.parse(
      await readFile(resolve(repositoryRoot, 'schemas/project/project.schema.json'), 'utf8'),
    ) as object;
    const validator = new Ajv2020({
      allErrors: true,
      strict: true,
      validateFormats: false,
    }).compile(schema);
    const project = new ProjectService(`prj_${randomUUID()}`, canonicalRoot, validator);
    await project.#loadAndValidateManifest();
    await project.#loadState();
    await project.listFiles();
    return project;
  }

  /** Returns the authoritative project head and a freshly digested canonical file index. */
  public async getSnapshot(): Promise<ProjectSnapshot> {
    const files = await this.listFiles();
    return {
      projectId: this.projectId,
      name: String(this.#manifest.name),
      projectKey: String(this.#manifest.projectKey),
      currentRevision: this.#state.revision,
      files,
      lastSuccessfulBuildId: this.#state.lastSuccessfulBuildId,
      currentPreview: this.#state.currentPreview,
    };
  }

  /** Reads all requested files against one optional expected revision; partial reads are forbidden. */
  public async readFiles(
    paths: readonly unknown[],
    expectedRevision?: unknown,
    maximumBytesPerFile = 262_144,
  ): Promise<(ProjectFile & { content: string; revision: string })[]> {
    if (paths.length === 0 || paths.length > 32) {
      throw new ServiceError('INVALID_REQUEST', 'One to 32 source paths are required.', 400, false);
    }
    this.#assertExpectedRevision(expectedRevision, false);
    const revision = this.#state.revision;
    const results: (ProjectFile & { content: string; revision: string })[] = [];
    for (const requestedPath of paths) {
      const confined = await resolveConfinedPath(this.root, requestedPath);
      const content = await readUtf8File(confined.absolutePath, maximumBytesPerFile);
      const bytes = Buffer.from(content, 'utf8');
      results.push({
        path: confined.logicalPath,
        sizeBytes: bytes.byteLength,
        sha256: sha256(bytes),
        mediaType: mediaType(confined.logicalPath),
        ownership: 'user',
        content,
        revision,
      });
    }
    // A mutation that lands during an asynchronous multi-file read would make the result internally
    // inconsistent. Detect it and ask the caller to retry rather than returning mixed revisions.
    if (revision !== this.#state.revision) {
      throw this.#revisionConflict(revision);
    }
    return results;
  }

  /** Applies a multi-file mutation atomically and advances the project revision exactly once. */
  public async applyPatches(
    expectedRevision: unknown,
    patches: readonly SourcePatch[],
  ): Promise<PatchResult> {
    return this.#serial.run(async () => {
      this.#assertExpectedRevision(expectedRevision, true);
      if (patches.length === 0 || patches.length > maximumPatchCount) {
        throw new ServiceError('INVALID_REQUEST', 'One to 32 patches are required.', 400, false);
      }
      const prepared = await this.#preparePatches(patches);
      if (prepared.every((entry) => entry.before === entry.after)) {
        throw new ServiceError('INVALID_REQUEST', 'No-op patch sets are not allowed.', 400, false);
      }

      const previousRevision = this.#state.revision;
      const revision = (BigInt(previousRevision) + 1n).toString();
      const postimageSha256 = Object.fromEntries(
        prepared.map((entry) => [
          entry.logicalPath,
          entry.after === null ? null : sha256(entry.after),
        ]),
      );
      const committedAt = new Date().toISOString();
      const nextState: PersistedProjectState = {
        schemaVersion: 1,
        revision,
        lastSuccessfulBuildId: this.#state.lastSuccessfulBuildId,
        currentPreview: this.#state.currentPreview,
        revisions: [
          ...this.#state.revisions.slice(-999),
          {
            revision,
            changedPaths: prepared.map((entry) => entry.logicalPath).sort(),
            postimageSha256,
            committedAt,
          },
        ],
      };
      await this.#commitPreparedMutation(prepared, nextState);
      // Replace the in-memory object with the exact bounded state written to disk. Keeping one
      // representation avoids divergent retention behavior between a live and restarted service.
      this.#state = nextState;
      return {
        previousRevision,
        revision,
        changedPaths: prepared.map((entry) => entry.logicalPath).sort(),
        postimageSha256,
      };
    });
  }

  /** Copies one immutable, revision-consistent source snapshot for a build worker. */
  public async createBuildSnapshot(destination: string): Promise<{
    revision: string;
    sourceDigest: string;
    assetDigest: string;
    files: readonly ProjectFile[];
  }> {
    return this.#serial.run(async () => {
      const revision = this.#state.revision;
      const files = await this.listFiles();
      await mkdir(destination, { recursive: true });
      for (const file of files) {
        const source = await resolveConfinedPath(this.root, file.path);
        const target = resolve(destination, ...file.path.split('/'));
        await mkdir(dirname(target), { recursive: true });
        await copyFile(source.absolutePath, target);
      }
      const digestEntries = (selected: readonly ProjectFile[]): string =>
        selected.map((file) => `${file.path}\0${file.sha256}\n`).join('');
      const sourceDigest = sha256(
        digestEntries(
          files.filter(
            (file) =>
              /\.(?:c|cc|cpp|cxx|h|hh|hpp|hxx)$/i.test(file.path) ||
              file.path === 'CMakeLists.txt' ||
              file.path === 'studio.project.json',
          ),
        ),
      );
      const assetDigest = sha256(
        digestEntries(files.filter((file) => file.path.startsWith('assets/'))),
      );
      return { revision, sourceDigest, assetDigest, files };
    });
  }

  /** Promotes a smoke-passed build and preview identity without changing project revision. */
  public async promoteBuild(buildId: string, preview: PreviewIdentity): Promise<void> {
    await this.#serial.run(async () => {
      const next = { ...this.#state, lastSuccessfulBuildId: buildId, currentPreview: preview };
      await this.#writeState(next);
      this.#state = next;
    });
  }

  /** Enumerates canonical files, rejects links, and computes stable lexical ordering and digests. */
  public async listFiles(): Promise<ProjectFile[]> {
    const paths: string[] = [];
    await walk(this.root, '', paths);
    if (paths.length > maximumIndexedFiles) {
      throw new ServiceError(
        'LIMIT_EXCEEDED',
        'The project contains too many canonical files.',
        400,
        false,
      );
    }
    const files: ProjectFile[] = [];
    for (const logicalPath of paths.sort((left, right) => left.localeCompare(right, 'en'))) {
      const confined = await resolveConfinedPath(this.root, logicalPath);
      const content = await readUtf8File(confined.absolutePath, maximumSourceBytes);
      const bytes = Buffer.from(content, 'utf8');
      files.push({
        path: logicalPath,
        sizeBytes: bytes.byteLength,
        sha256: sha256(bytes),
        mediaType: mediaType(logicalPath),
        ownership: 'user',
      });
    }
    return files;
  }

  public get currentRevision(): string {
    return this.#state.revision;
  }

  public get manifest(): Readonly<Record<string, unknown>> {
    return this.#manifest;
  }

  async #loadAndValidateManifest(): Promise<void> {
    const manifestPath = await resolveConfinedPath(this.root, 'studio.project.json');
    const content = await readUtf8File(manifestPath.absolutePath, 256 * 1024);
    let manifest: unknown;
    try {
      manifest = JSON.parse(content);
    } catch {
      throw new ServiceError(
        'PROJECT_INVALID',
        'studio.project.json is not valid JSON.',
        400,
        false,
      );
    }
    if (!this.#manifestValidator(manifest)) {
      throw new ServiceError(
        'PROJECT_INVALID',
        'studio.project.json failed schema validation.',
        400,
        false,
        {
          errors: this.#manifestValidator.errors?.slice(0, 16),
        },
      );
    }
    this.#manifest = manifest as Record<string, unknown>;
    for (const requiredPath of [
      'CMakeLists.txt',
      String(this.#manifest.assetsManifest),
      String(this.#manifest.referencesManifest),
    ]) {
      await resolveConfinedPath(this.root, requiredPath);
    }
  }

  async #loadState(): Promise<void> {
    const statePath = this.#statePath();
    try {
      const parsed = JSON.parse(await readFile(statePath, 'utf8')) as PersistedProjectState;
      if (parsed.schemaVersion !== 1 || !/^(0|[1-9][0-9]*)$/.test(parsed.revision)) {
        throw new Error('invalid state');
      }
      this.#state = parsed;
    } catch (error) {
      if (
        !(error instanceof SyntaxError) &&
        !isMissing(error) &&
        !(error instanceof Error && error.message === 'invalid state')
      ) {
        throw error;
      }
      this.#state = {
        schemaVersion: 1,
        revision: '0',
        lastSuccessfulBuildId: null,
        currentPreview: null,
        revisions: [],
      };
      await this.#writeState(this.#state);
    }
  }

  async #preparePatches(patches: readonly SourcePatch[]): Promise<PreparedPatch[]> {
    const seen = new Set<string>();
    const prepared: PreparedPatch[] = [];
    for (const patch of patches) {
      const logicalPath = normalizeProjectPath(patch.path);
      const collisionKey = logicalPath.toLocaleLowerCase('en-US');
      if (seen.has(collisionKey)) {
        throw new ServiceError(
          'INVALID_REQUEST',
          'A patch set may name each file only once.',
          400,
          false,
        );
      }
      seen.add(collisionKey);
      const confined = await resolveConfinedPath(
        this.root,
        logicalPath,
        patch.expectedSha256 === null,
      );
      let before: string | null = null;
      try {
        before = await readUtf8File(confined.absolutePath, maximumSourceBytes);
      } catch (error) {
        if (!(
          error instanceof ServiceError &&
          error.code === 'FILE_NOT_FOUND' &&
          patch.expectedSha256 === null
        )) {
          throw error;
        }
      }
      const actualDigest = before === null ? null : sha256(Buffer.from(before, 'utf8'));
      if (actualDigest !== patch.expectedSha256) {
        throw new ServiceError(
          'REVISION_CONFLICT',
          'A patch preimage digest is stale.',
          409,
          true,
          {
            path: logicalPath,
            expectedSha256: patch.expectedSha256,
            currentSha256: actualDigest,
          },
        );
      }
      const after = patch.delete ? null : applyUnifiedDiff(before ?? '', patch.unifiedDiff);
      if (after !== null) {
        new TextEncoder().encode(after);
      }
      prepared.push({ logicalPath, absolutePath: confined.absolutePath, before, after });
    }
    return prepared;
  }

  async #commitPreparedMutation(
    prepared: readonly PreparedPatch[],
    nextState: PersistedProjectState,
  ): Promise<void> {
    const transactionId = randomUUID();
    const staged: TransactionPath[] = [];
    let committed = false;
    try {
      for (const entry of prepared) {
        // Re-resolve immediately before staging to narrow the window in which a parent directory
        // could be replaced with a link by another local process.
        const confined = await resolveConfinedPath(
          this.root,
          entry.logicalPath,
          entry.before === null,
        );
        const stagePath = `${confined.absolutePath}.${transactionId}.stage`;
        const backupPath = `${confined.absolutePath}.${transactionId}.backup`;
        if (entry.after !== null) {
          await writeFile(stagePath, entry.after, { encoding: 'utf8', flag: 'wx' });
        }
        staged.push({
          ...entry,
          absolutePath: confined.absolutePath,
          stagePath,
          backupPath,
          installed: false,
          backedUp: false,
        });
      }
      for (const entry of staged) {
        if (entry.before !== null) {
          await rename(entry.absolutePath, entry.backupPath);
          entry.backedUp = true;
        }
        if (entry.after !== null) {
          await rename(entry.stagePath, entry.absolutePath);
          entry.installed = true;
        }
      }
      await this.#writeState(nextState);
      committed = true;
    } catch (error) {
      // Roll back in reverse promotion order. Canonical files remain byte-identical if any stage,
      // rename, or revision-state write fails before the transaction commits.
      for (const entry of [...staged].reverse()) {
        if (entry.installed) {
          await rm(entry.absolutePath, { force: true });
        }
        if (entry.backedUp) {
          await rename(entry.backupPath, entry.absolutePath);
        }
      }
      throw error;
    } finally {
      for (const entry of staged) {
        await rm(entry.stagePath, { force: true });
        // Once the revision state is durably replaced, the new files are canonical. Backup
        // deletion is therefore cleanup, never a reason to restore the previous source beneath
        // an already-advanced revision.
        if (committed) {
          await rm(entry.backupPath, { force: true });
        }
      }
    }
  }

  #assertExpectedRevision(expected: unknown, required: boolean): void {
    if (expected === undefined && !required) {
      return;
    }
    if (typeof expected !== 'string' || !/^(0|[1-9][0-9]*)$/.test(expected)) {
      throw new ServiceError(
        'INVALID_REQUEST',
        'expectedRevision must be a decimal string.',
        400,
        false,
      );
    }
    if (expected !== this.#state.revision) {
      throw this.#revisionConflict(expected);
    }
  }

  #revisionConflict(expectedRevision: string): ServiceError {
    return new ServiceError(
      'REVISION_CONFLICT',
      'The project changed after this request was prepared.',
      409,
      true,
      {
        expectedRevision,
        currentRevision: this.#state.revision,
      },
    );
  }

  #statePath(): string {
    return resolve(this.root, '.studio/service-state.json');
  }

  async #writeState(state: PersistedProjectState): Promise<void> {
    await writeAtomic(this.#statePath(), `${JSON.stringify(state, null, 2)}\n`);
  }
}

interface PreparedPatch {
  readonly logicalPath: string;
  readonly absolutePath: string;
  readonly before: string | null;
  readonly after: string | null;
}

interface TransactionPath extends PreparedPatch {
  readonly stagePath: string;
  readonly backupPath: string;
  installed: boolean;
  backedUp: boolean;
}

class SerialQueue {
  #tail: Promise<void> = Promise.resolve();

  public async run<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.#tail;
    let release: (() => void) | undefined;
    this.#tail = new Promise<void>((resolvePromise) => {
      release = resolvePromise;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release?.();
    }
  }
}

async function walk(root: string, relativeDirectory: string, output: string[]): Promise<void> {
  const directory = resolve(root, ...relativeDirectory.split('/').filter(Boolean));
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === '.studio') {
      continue;
    }
    const logicalPath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
    const absolutePath = resolve(directory, entry.name);
    const entryStatus = await lstat(absolutePath);
    if (entryStatus.isSymbolicLink()) {
      throw new ServiceError(
        'PATH_OUTSIDE_PROJECT',
        'Linked project entries are not supported.',
        400,
        false,
        {
          path: logicalPath,
        },
      );
    }
    if (entryStatus.isDirectory()) {
      await walk(root, logicalPath, output);
    } else if (entryStatus.isFile()) {
      output.push(logicalPath.replaceAll('\\', '/'));
    }
  }
}

function mediaType(path: string): ProjectFile['mediaType'] {
  const extension = extname(path).toLowerCase();
  if (['.cpp', '.cc', '.cxx'].includes(extension)) return 'text/x-c++src';
  if (['.hpp', '.h', '.hxx'].includes(extension)) return 'text/x-c++hdr';
  if (extension === '.json') return 'application/json';
  return 'text/plain';
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
