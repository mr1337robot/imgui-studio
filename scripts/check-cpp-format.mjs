import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(
  readFileSync(resolve(repositoryRoot, 'toolchain/toolchain.json'), 'utf8'),
);
const clangFormat = locateClangFormat();
const versionResult = spawnSync(clangFormat, ['--version'], {
  encoding: 'utf8',
  windowsHide: true,
});

if (versionResult.error || versionResult.status !== 0) {
  fail(`Unable to execute clang-format at '${clangFormat}'.`);
}

const versionMatch = `${versionResult.stdout}\n${versionResult.stderr}`.match(
  /clang-format version ([0-9]+\.[0-9]+\.[0-9]+)/,
);
const actualVersion = versionMatch?.[1] ?? 'unknown';
if (actualVersion !== manifest.native.clangFormat) {
  fail(
    `clang-format ${actualVersion} does not match pinned version ${manifest.native.clangFormat}.`,
  );
}

const sourceFiles = ['apps', 'components', 'examples', 'runtime', 'tests']
  .flatMap((directory) => findCppFiles(resolve(repositoryRoot, directory)))
  .sort((left, right) => left.localeCompare(right, 'en'));

if (sourceFiles.length === 0) {
  fail('No C++ source files were found for formatting validation.');
}

const formatResult = spawnSync(clangFormat, ['--dry-run', '--Werror', ...sourceFiles], {
  encoding: 'utf8',
  windowsHide: true,
});
if (formatResult.error || formatResult.status !== 0) {
  process.stderr.write(formatResult.stdout ?? '');
  process.stderr.write(formatResult.stderr ?? '');
  fail('C++ formatting check failed. Run clang-format with the repository .clang-format file.');
}

console.log(
  `C++ formatting is current (${sourceFiles.length} files, clang-format ${actualVersion}).`,
);

function locateClangFormat() {
  if (process.env.CLANG_FORMAT && existsSync(process.env.CLANG_FORMAT)) {
    return process.env.CLANG_FORMAT;
  }

  const pathProbe = spawnSync('clang-format', ['--version'], {
    encoding: 'utf8',
    windowsHide: true,
  });
  if (!pathProbe.error) {
    return 'clang-format';
  }

  if (process.platform === 'win32') {
    const programFilesX86 = process.env['ProgramFiles(x86)'];
    if (programFilesX86) {
      const vswhere = resolve(programFilesX86, 'Microsoft Visual Studio/Installer/vswhere.exe');
      if (existsSync(vswhere)) {
        const query = spawnSync(
          vswhere,
          ['-latest', '-products', '*', '-property', 'installationPath'],
          { encoding: 'utf8', windowsHide: true },
        );
        const installationPath = query.stdout?.trim();
        if (installationPath) {
          const candidate = resolve(installationPath, 'VC/Tools/Llvm/bin/clang-format.exe');
          if (existsSync(candidate)) {
            return candidate;
          }
        }
      }
    }
  }

  fail(
    'clang-format is unavailable. Install the pinned Visual Studio LLVM component or set CLANG_FORMAT.',
  );
}

function findCppFiles(directory) {
  if (!existsSync(directory)) {
    return [];
  }
  const result = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      result.push(...findCppFiles(path));
    } else if (entry.isFile() && /\.(?:c|cc|cpp|cxx|h|hh|hpp|hxx)$/.test(entry.name)) {
      result.push(path);
    }
  }
  return result;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
