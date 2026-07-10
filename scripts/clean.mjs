import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));

for (const relativePath of ['build', 'out']) {
  const target = resolve(repositoryRoot, relativePath);
  if (!target.startsWith(resolve(repositoryRoot))) {
    throw new Error(`Refusing to remove path outside repository: ${target}`);
  }
  rmSync(target, { force: true, recursive: true });
}
