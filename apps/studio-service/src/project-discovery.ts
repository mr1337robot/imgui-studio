import { lstat, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { canonicalizeRoot } from './filesystem.ts';

const maximumDiscoveryDepth = 6;
const maximumDiscoveredDirectories = 10_000;

/** Finds manifest roots beneath configured workspace roots without following directory links. */
export async function discoverProjectRoots(workspaceRoots: readonly string[]): Promise<string[]> {
  const projects: string[] = [];
  let visitedDirectories = 0;
  for (const configuredRoot of workspaceRoots) {
    const workspaceRoot = await canonicalizeRoot(configuredRoot);
    await visit(workspaceRoot, 0);
  }
  return projects.sort((left, right) => left.localeCompare(right, 'en'));

  async function visit(directory: string, depth: number): Promise<void> {
    visitedDirectories += 1;
    if (visitedDirectories > maximumDiscoveredDirectories || depth > maximumDiscoveryDepth) return;
    const entries = await readdir(directory, { withFileTypes: true });
    if (entries.some((entry) => entry.isFile() && entry.name === 'studio.project.json')) {
      projects.push(directory);
      return; // A project root owns its subtree; nested projects are not implicitly opened.
    }
    for (const entry of entries) {
      if (
        !entry.isDirectory() ||
        entry.name.startsWith('.') ||
        entry.name === 'node_modules' ||
        entry.name === 'build'
      ) {
        continue;
      }
      const child = resolve(directory, entry.name);
      const childStatus = await lstat(child);
      if (!childStatus.isSymbolicLink()) await visit(child, depth + 1);
    }
  }
}
