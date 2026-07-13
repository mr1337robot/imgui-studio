import { cp, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProjectService } from '../../../apps/studio-service/src/project-service.ts';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const temporaryRoots: string[] = [];
let projectRoot: string;
let project: ProjectService;

beforeEach(async () => {
  projectRoot = await mkdtemp(resolve(tmpdir(), 'imgui-studio-project-'));
  temporaryRoots.push(projectRoot);
  await cp(resolve(repositoryRoot, 'examples/starter'), projectRoot, {
    recursive: true,
    filter: (source) => !source.includes(resolve(repositoryRoot, 'examples/starter/.studio')),
  });
  await rm(resolve(projectRoot, '.studio'), { recursive: true, force: true });
  project = await ProjectService.open(projectRoot, repositoryRoot);
});

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe('canonical project revisions', () => {
  it('advances exactly once for a valid patch and persists the revision', async () => {
    const file = required((await project.readFiles(['src/studio_managed_theme.cpp'], '0'))[0]);
    const patch = replacementPatch(
      file.content,
      'animationDurationSeconds = 0.16F',
      'animationDurationSeconds = 0.24F',
    );
    const result = await project.applyPatches('0', [
      { path: file.path, expectedSha256: file.sha256, unifiedDiff: patch },
    ]);

    expect(result.previousRevision).toBe('0');
    expect(result.revision).toBe('1');
    expect(
      required((await project.readFiles(['src/studio_managed_theme.cpp'], '1'))[0]).content,
    ).toContain('animationDurationSeconds = 0.24F');
    expect((await ProjectService.open(projectRoot, repositoryRoot)).currentRevision).toBe('1');
  });

  it('rejects stale revisions and stale preimage digests without changing bytes', async () => {
    const path = resolve(projectRoot, 'src/studio_managed_theme.cpp');
    const before = await readFile(path);
    const file = required((await project.readFiles(['src/studio_managed_theme.cpp']))[0]);
    const patch = replacementPatch(
      file.content,
      'animationDurationSeconds = 0.16F',
      'animationDurationSeconds = 0.24F',
    );

    await expect(
      project.applyPatches('9', [
        { path: file.path, expectedSha256: file.sha256, unifiedDiff: patch },
      ]),
    ).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    await expect(
      project.applyPatches('0', [
        { path: file.path, expectedSha256: '0'.repeat(64), unifiedDiff: patch },
      ]),
    ).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    expect(await readFile(path)).toEqual(before);
    expect(project.currentRevision).toBe('0');
  });

  it('serializes simultaneous mutations so only one stale caller succeeds', async () => {
    const file = required((await project.readFiles(['src/studio_managed_theme.cpp']))[0]);
    const first = project.applyPatches('0', [
      {
        path: file.path,
        expectedSha256: file.sha256,
        unifiedDiff: replacementPatch(
          file.content,
          'animationDurationSeconds = 0.16F',
          'animationDurationSeconds = 0.24F',
        ),
      },
    ]);
    const second = project.applyPatches('0', [
      {
        path: file.path,
        expectedSha256: file.sha256,
        unifiedDiff: replacementPatch(
          file.content,
          'animationDurationSeconds = 0.16F',
          'animationDurationSeconds = 0.26F',
        ),
      },
    ]);
    const outcomes = await Promise.allSettled([first, second]);
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1);
    expect(project.currentRevision).toBe('1');
  });
});

describe('project path and encoding boundaries', () => {
  it.each(['../outside.cpp', 'C:/outside.cpp', '/outside.cpp', 'src\\menu.cpp', 'src/../menu.cpp'])(
    'rejects unsafe logical path %s',
    async (path) => {
      await expect(project.readFiles([path])).rejects.toMatchObject({
        code: 'PATH_OUTSIDE_PROJECT',
      });
    },
  );

  it('rejects a linked file that escapes the project', async () => {
    const externalRoot = await mkdtemp(resolve(tmpdir(), 'imgui-studio-external-'));
    temporaryRoots.push(externalRoot);
    const external = resolve(externalRoot, 'secret.cpp');
    await writeFile(external, 'secret');
    await symlink(external, resolve(projectRoot, 'src/linked.cpp'), 'file');
    await expect(project.readFiles(['src/linked.cpp'])).rejects.toMatchObject({
      code: 'PATH_OUTSIDE_PROJECT',
    });
  });

  it('rejects malformed UTF-8 without returning replacement characters', async () => {
    await writeFile(resolve(projectRoot, 'src/invalid.cpp'), Buffer.from([0xc3, 0x28]));
    await expect(project.readFiles(['src/invalid.cpp'])).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    });
  });
});

describe('portable asset boundaries', () => {
  it('indexes the project-provided binary fonts without UTF-8 decoding', async () => {
    const files = await project.listFiles();
    // Both explicit weights must survive discovery as opaque bytes. Reading either TTF as text
    // would reject valid binary sequences before the build could construct the shared atlas.
    for (const path of ['assets/fonts/Inter-Medium.ttf', 'assets/fonts/Inter-SemiBold.ttf']) {
      const font = files.find((file) => file.path === path);
      expect(font?.sizeBytes).toBeGreaterThan(100_000);
      expect(font?.sha256).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  it('accepts the checked-in licensed starter SVG during project discovery', async () => {
    await expect(project.validateAssets()).resolves.toBeUndefined();
  });

  it('rejects active SVG content before a build snapshot is created', async () => {
    await writeFile(
      resolve(projectRoot, 'assets/icons/studio-mark.svg'),
      '<svg><script>alert(1)</script></svg>',
      'utf8',
    );

    await expect(project.validateAssets()).rejects.toMatchObject({
      code: 'ASSET_INVALID',
      details: { assetId: 'icon.studio-mark', path: 'assets/icons/studio-mark.svg' },
    });
  });

  it('rejects a missing required attribution file with only its logical path exposed', async () => {
    await rm(resolve(projectRoot, 'assets/licenses/studio-mark.txt'));

    await expect(project.validateAssets()).rejects.toMatchObject({
      code: 'ASSET_INVALID',
      details: { path: 'assets/licenses/studio-mark.txt' },
    });
  });
});

function replacementPatch(content: string, before: string, after: string): string {
  const lines = content.replaceAll('\r\n', '\n').replace(/\n$/, '').split('\n');
  const index = lines.findIndex((line) => line.includes(before));
  if (index < 0) throw new Error(`Fixture text not found: ${before}`);
  const line = required(lines[index]);
  const lineNumber = String(index + 1);
  return `@@ -${lineNumber},1 +${lineNumber},1 @@\n-${line}\n+${line.replace(before, after)}\n`;
}

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Expected fixture value was missing.');
  return value;
}
