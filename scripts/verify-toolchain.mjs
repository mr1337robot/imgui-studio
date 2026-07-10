import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const rootUrl = new URL('../', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('toolchain/toolchain.json', rootUrl), 'utf8'));
const npmCliPath =
  process.env.npm_execpath ?? resolve(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');

const profileArgumentIndex = process.argv.indexOf('--profile');
const profile =
  profileArgumentIndex >= 0
    ? process.argv[profileArgumentIndex + 1]
    : process.platform === 'win32'
      ? 'native'
      : 'common';

if (!['common', 'native', 'wasm', 'all'].includes(profile)) {
  fail(`Unknown profile '${profile}'. Expected common, native, wasm, or all.`);
}

const checks = [];

checks.push(
  checkExact(
    'Node.js',
    process.versions.node,
    manifest.host.node,
    'Install the pinned Node.js release.',
  ),
);
checks.push(
  checkCommand(
    'npm',
    process.execPath,
    [npmCliPath, '--version'],
    /^([0-9]+\.[0-9]+\.[0-9]+)/m,
    manifest.host.npm,
    'Install it with: npm install --global npm@' + manifest.host.npm,
  ),
);
checks.push(
  checkCommand(
    'CMake',
    'cmake',
    ['--version'],
    /cmake version ([0-9]+\.[0-9]+\.[0-9]+)/,
    manifest.host.cmake,
    'Install the exact CMake release recorded in toolchain/toolchain.json.',
  ),
);
checks.push(
  checkCommandMinimum(
    'Git',
    'git',
    ['--version'],
    /git version ([0-9]+\.[0-9]+\.[0-9]+)/,
    manifest.host.gitMinimum,
    'Install Git at or above the minimum recorded in toolchain/toolchain.json.',
  ),
);

if (profile === 'native' || profile === 'all') {
  if (process.platform !== 'win32') {
    fail('The native MVP profile requires Windows and MSVC.');
  }
  checks.push(
    checkCommand(
      'MSVC',
      'cl.exe',
      [],
      /Compiler Version ([0-9]+\.[0-9]+\.[0-9]+)/,
      manifest.native.msvcCompiler,
      'Run from the pinned Visual Studio 2022 developer environment.',
      true,
    ),
  );
}

if (profile === 'wasm' || profile === 'all') {
  const emccCommand =
    process.platform === 'win32' && process.env.EMSDK_PYTHON ? process.env.EMSDK_PYTHON : 'emcc';
  const emccArguments =
    process.platform === 'win32' && process.env.EMSDK
      ? [resolve(process.env.EMSDK, 'upstream/emscripten/emcc.py'), '--version']
      : ['--version'];
  checks.push(
    checkCommand(
      'Emscripten',
      emccCommand,
      emccArguments,
      /emcc .*? ([0-9]+\.[0-9]+\.[0-9]+)/,
      manifest.browser.emscripten,
      'Run toolchain/bootstrap-emscripten.ps1, then load emsdk_env.ps1 in this shell.',
    ),
  );
}

const failures = checks.filter((check) => !check.ok);
for (const check of checks) {
  const marker = check.ok ? 'PASS' : 'FAIL';
  console.log(
    `[${marker}] ${check.name}: ${check.actual ?? 'not found'} (expected ${check.expected})`,
  );
  if (!check.ok) {
    console.log(`       ${check.remediation}`);
  }
}

if (failures.length > 0) {
  process.exitCode = 1;
} else {
  console.log(`Toolchain profile '${profile}' matches ${manifest.versionSet}.`);
}

function checkExact(name, actual, expected, remediation) {
  return { name, actual, expected, remediation, ok: actual === expected };
}

function checkCommand(name, command, args, pattern, expected, remediation, acceptFailure = false) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  if (result.error) {
    return { name, actual: null, expected, remediation, ok: false };
  }
  const output = `${toText(result.stdout)}\n${toText(result.stderr)}`;
  const parsed = fromOutput(name, output, pattern, expected, remediation);
  if (parsed.actual !== null || acceptFailure) {
    return parsed;
  }
  return { name, actual: null, expected, remediation, ok: false };
}

function toText(value) {
  if (typeof value === 'string') {
    return value;
  }
  if (Buffer.isBuffer(value)) {
    return value.toString('utf8');
  }
  return '';
}

function checkCommandMinimum(name, command, args, pattern, expected, remediation) {
  const check = checkCommand(name, command, args, pattern, expected, remediation);
  if (check.actual !== null) {
    check.ok = compareVersions(check.actual, expected) >= 0;
    check.expected = `>= ${expected}`;
  }
  return check;
}

function compareVersions(left, right) {
  const leftParts = left.split('.').map(Number);
  const rightParts = right.split('.').map(Number);
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) {
      return Math.sign(difference);
    }
  }
  return 0;
}

function fromOutput(name, output, pattern, expected, remediation) {
  const match = output.match(pattern);
  const actual = match?.[1] ?? null;
  return { name, actual, expected, remediation, ok: actual === expected };
}

function fail(message) {
  console.error(message);
  process.exit(2);
}
