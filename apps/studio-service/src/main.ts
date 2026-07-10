import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { StudioHttpServer } from './http-server.ts';
import { discoverProjectRoots } from './project-discovery.ts';
import { ProjectService } from './project-service.ts';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const workspaceRoots = parseWorkspaceRoots(process.argv.slice(2));
const discovered = await discoverProjectRoots(
  workspaceRoots.length === 0 ? [resolve(repositoryRoot, 'examples')] : workspaceRoots,
);
if (discovered.length === 0) {
  throw new Error('No valid studio.project.json was found under the configured workspace roots.');
}
if (discovered.length > 1) {
  throw new Error(
    'Phase 2 supports one active project; configure a workspace containing one project.',
  );
}

const projectRoot = discovered[0];
if (projectRoot === undefined) throw new Error('Project discovery returned no usable root.');
const project = await ProjectService.open(projectRoot, repositoryRoot);
const server = new StudioHttpServer(repositoryRoot, project);
const launch = await server.listen();

// The token is printed once to the trusted launching terminal. It is never placed in a URL or log
// event; the served Studio document receives it through a nonce-protected bootstrap block.
console.log(`ImGui Studio service: ${launch.studioUrl}`);
console.log(`Session token: ${launch.token}`);
console.log(`Active project: ${(await project.getSnapshot()).name}`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void server.close().finally(() => process.exit(0));
  });
}

function parseWorkspaceRoots(arguments_: readonly string[]): string[] {
  const roots: string[] = [];
  for (let index = 0; index < arguments_.length; index += 1) {
    if (arguments_[index] !== '--workspace' || arguments_[index + 1] === undefined) {
      throw new Error(`Invalid service argument near '${arguments_[index] ?? ''}'.`);
    }
    const value = arguments_[index + 1];
    if (value === undefined) throw new Error('A workspace path is required.');
    roots.push(resolve(value));
    index += 1;
  }
  return roots;
}
