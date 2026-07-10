import { createHash, randomUUID } from 'node:crypto';
import {
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { ServiceError } from './service-error.ts';

const maximumLogicalPathCharacters = 260;

/** Returns the lowercase SHA-256 digest used for revisions, preimages, and cache identities. */
export function sha256(bytes: string | Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * Validates and normalizes a project-relative protocol path without touching the filesystem.
 *
 * Protocol paths always use `/`; accepting Windows separators would make validation differ between
 * browser agents and the Windows service. The returned string is Unicode NFC-normalized.
 */
export function normalizeProjectPath(input: unknown): string {
  if (
    typeof input !== 'string' ||
    input.length === 0 ||
    input.length > maximumLogicalPathCharacters
  ) {
    throw new ServiceError('PATH_OUTSIDE_PROJECT', 'The project path is invalid.', 400, false);
  }
  const normalized = input.normalize('NFC');
  if (
    isAbsolute(normalized) ||
    normalized.startsWith('/') ||
    normalized.startsWith('\\') ||
    /^[A-Za-z]:/.test(normalized) ||
    normalized.includes('\\') ||
    normalized.includes('\0')
  ) {
    throw new ServiceError('PATH_OUTSIDE_PROJECT', 'The project path is invalid.', 400, false);
  }
  const segments = normalized.split('/');
  if (segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')) {
    throw new ServiceError('PATH_OUTSIDE_PROJECT', 'The project path is invalid.', 400, false);
  }
  return segments.join('/');
}

/** Canonicalizes a configured root and verifies it is a real directory rather than a link. */
export async function canonicalizeRoot(root: string): Promise<string> {
  const absolute = resolve(root);
  const rootStatus = await lstat(absolute);
  if (!rootStatus.isDirectory() || rootStatus.isSymbolicLink()) {
    throw new ServiceError(
      'PROJECT_INVALID',
      'The project root is not a canonical directory.',
      400,
      false,
    );
  }
  return realpath(absolute);
}

/**
 * Resolves one logical path beneath a canonical project root and rejects link/reparse traversal.
 *
 * `allowMissingLeaf` is used only for file creation. Every existing parent is checked before the
 * caller writes and should be rechecked immediately before rename by the mutation transaction.
 */
export async function resolveConfinedPath(
  canonicalRoot: string,
  logicalPath: unknown,
  allowMissingLeaf = false,
): Promise<{ logicalPath: string; absolutePath: string }> {
  const normalized = normalizeProjectPath(logicalPath);
  const segments = normalized.split('/');
  let current = canonicalRoot;
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (segment === undefined)
      throw new ServiceError('PATH_OUTSIDE_PROJECT', 'The project path is invalid.', 400, false);
    current = resolve(current, segment);
    assertContained(canonicalRoot, current);
    try {
      const currentStatus = await lstat(current);
      // On Windows, directory junctions are reported as symbolic links by Node. Rejecting all links
      // keeps reads and mutations within a simple, auditable project tree for the MVP.
      if (currentStatus.isSymbolicLink()) {
        throw new ServiceError(
          'PATH_OUTSIDE_PROJECT',
          'Linked project paths are not supported.',
          400,
          false,
          {
            path: normalized,
          },
        );
      }
    } catch (error) {
      if (isMissing(error) && allowMissingLeaf && index === segments.length - 1) {
        return { logicalPath: normalized, absolutePath: current };
      }
      if (error instanceof ServiceError) {
        throw error;
      }
      if (isMissing(error)) {
        throw new ServiceError(
          'FILE_NOT_FOUND',
          'The requested project file does not exist.',
          404,
          false,
          {
            path: normalized,
          },
        );
      }
      throw error;
    }
  }
  const finalPath = await realpath(current);
  assertContained(canonicalRoot, finalPath);
  return { logicalPath: normalized, absolutePath: finalPath };
}

/** Reads a bounded UTF-8 file and rejects malformed byte sequences instead of replacing them. */
export async function readUtf8File(path: string, maximumBytes: number): Promise<string> {
  const fileStatus = await stat(path);
  if (!fileStatus.isFile()) {
    throw new ServiceError(
      'FILE_NOT_FOUND',
      'The requested project path is not a regular file.',
      404,
      false,
    );
  }
  if (fileStatus.size > maximumBytes) {
    throw new ServiceError(
      'LIMIT_EXCEEDED',
      'The requested file exceeds the read limit.',
      413,
      false,
      {
        maximumBytes,
      },
    );
  }
  const bytes = await readFile(path);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new ServiceError(
      'INVALID_REQUEST',
      'The requested source is not valid UTF-8.',
      400,
      false,
    );
  }
}

/** Writes one service-owned state file using same-directory replace semantics. */
export async function writeAtomic(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, content, { encoding: 'utf8', flag: 'wx' });
    const file = await open(temporaryPath, 'r+');
    try {
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporaryPath, path);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

function assertContained(root: string, candidate: string): void {
  const relativePath = relative(root, candidate);
  const outside =
    relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath);
  if (outside) {
    throw new ServiceError(
      'PATH_OUTSIDE_PROJECT',
      'The project path is outside the active project.',
      400,
      false,
    );
  }
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
