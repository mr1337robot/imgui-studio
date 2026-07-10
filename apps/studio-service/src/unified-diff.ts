import { ServiceError } from './service-error.ts';

const hunkHeader = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?: .*)?$/;

/**
 * Applies a bounded unified diff to UTF-8 text using exact context matching.
 *
 * The implementation supports ordinary context/add/remove hunks and rejects fuzzy application.
 * Exact matching is intentional: the preimage digest protects the entire file, while hunk context
 * makes malformed or incorrectly generated patches fail before any canonical write is staged.
 */
export function applyUnifiedDiff(source: string, unifiedDiff: string): string {
  if (unifiedDiff.length === 0 || unifiedDiff.length > 512 * 1024) {
    throw invalidPatch('The unified diff is empty or exceeds the patch limit.');
  }

  const normalizedSource = source.replaceAll('\r\n', '\n');
  const sourceEndsWithNewline = normalizedSource.endsWith('\n');
  const sourceLines = toLogicalLines(normalizedSource);
  const diffLines = unifiedDiff.replaceAll('\r\n', '\n').split('\n');
  const result: string[] = [];
  let sourceIndex = 0;
  let diffIndex = 0;
  let hunkCount = 0;

  // File headers carry names for standard tooling, but authorization comes exclusively from the
  // request's separately validated `path`; diff headers are never interpreted as filesystem paths.
  if (diffLines[diffIndex]?.startsWith('--- ')) {
    diffIndex += 1;
  }
  if (diffLines[diffIndex]?.startsWith('+++ ')) {
    diffIndex += 1;
  }

  while (diffIndex < diffLines.length) {
    if (diffLines[diffIndex] === '') {
      diffIndex += 1;
      continue;
    }
    const headerLine = diffLines[diffIndex];
    if (headerLine === undefined) break;
    const match = hunkHeader.exec(headerLine);
    if (!match) {
      throw invalidPatch('The unified diff contains an invalid hunk header.');
    }
    const oldStart = Number(match[1]);
    const oldCount = Number(match[2] ?? 1);
    const newCount = Number(match[4] ?? 1);
    const targetSourceIndex = oldCount === 0 ? oldStart : oldStart - 1;
    if (targetSourceIndex < sourceIndex || targetSourceIndex > sourceLines.length) {
      throw invalidPatch('A unified diff hunk points outside the source file.');
    }
    result.push(...sourceLines.slice(sourceIndex, targetSourceIndex));
    sourceIndex = targetSourceIndex;
    diffIndex += 1;
    hunkCount += 1;

    let consumedOld = 0;
    let producedNew = 0;
    while (diffIndex < diffLines.length) {
      const line = diffLines[diffIndex];
      if (line === undefined || line.startsWith('@@ ')) break;
      if (line === '' && diffIndex === diffLines.length - 1) {
        diffIndex += 1;
        break;
      }
      const marker = line[0];
      const payload = line.slice(1);
      if (marker === ' ' || marker === '-') {
        if (sourceLines[sourceIndex] !== payload) {
          throw invalidPatch('Unified diff context does not match the current file.');
        }
        sourceIndex += 1;
        consumedOld += 1;
      }
      if (marker === ' ' || marker === '+') {
        result.push(payload);
        producedNew += 1;
      } else if (marker !== '-') {
        if (line !== '\\ No newline at end of file') {
          throw invalidPatch('The unified diff contains an unsupported line marker.');
        }
      }
      diffIndex += 1;
    }
    if (consumedOld !== oldCount || producedNew !== newCount) {
      throw invalidPatch('A unified diff hunk count does not match its body.');
    }
  }

  if (hunkCount === 0) {
    throw invalidPatch('The unified diff contains no hunks.');
  }
  result.push(...sourceLines.slice(sourceIndex));
  return `${result.join('\n')}${sourceEndsWithNewline ? '\n' : ''}`;
}

function toLogicalLines(content: string): string[] {
  if (content.length === 0) {
    return [];
  }
  const withoutTrailingNewline = content.endsWith('\n') ? content.slice(0, -1) : content;
  return withoutTrailingNewline.length === 0 ? [''] : withoutTrailingNewline.split('\n');
}

function invalidPatch(message: string): ServiceError {
  return new ServiceError('INVALID_REQUEST', message, 400, false);
}
