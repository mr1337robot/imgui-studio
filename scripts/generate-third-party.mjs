import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const lock = JSON.parse(readFileSync(resolve(repositoryRoot, 'package-lock.json'), 'utf8'));
const outputPath = resolve(repositoryRoot, 'THIRD_PARTY_DEPENDENCIES.json');
const checkOnly = process.argv.includes('--check');

const dependencies = [];
for (const [packagePath, lockEntry] of Object.entries(lock.packages)) {
  if (packagePath === '' || !packagePath.startsWith('node_modules/')) {
    continue;
  }
  const name = packagePath.split('node_modules/').at(-1);
  if (!name || typeof lockEntry.version !== 'string') {
    throw new Error(`Invalid package-lock entry at '${packagePath}'.`);
  }
  dependencies.push({
    name,
    version: lockEntry.version,
    license: normalizeLicense(lockEntry.license),
    resolved: lockEntry.resolved ?? null,
    integrity: lockEntry.integrity ?? null,
  });
}

dependencies.sort((left, right) =>
  `${left.name}@${left.version}`.localeCompare(`${right.name}@${right.version}`, 'en'),
);

const output = `${JSON.stringify(
  {
    schemaVersion: 1,
    generatedFrom: 'package-lock.json',
    dependencies,
  },
  null,
  2,
)}\n`;

if (dependencies.some((dependency) => dependency.license === 'UNKNOWN')) {
  console.error('One or more npm dependencies do not declare a recognizable license.');
  process.exit(1);
}

if (checkOnly) {
  let current;
  try {
    current = readFileSync(outputPath, 'utf8');
  } catch {
    console.error('THIRD_PARTY_DEPENDENCIES.json is missing. Run: npm run licenses:generate');
    process.exit(1);
  }
  if (current !== output) {
    console.error('Third-party dependency inventory is stale. Run: npm run licenses:generate');
    process.exit(1);
  }
  console.log(`Third-party dependency inventory is current (${dependencies.length} packages).`);
} else {
  writeFileSync(outputPath, output, 'utf8');
  console.log(`Recorded ${dependencies.length} npm package licenses.`);
}

function normalizeLicense(license) {
  if (typeof license === 'string' && license.trim().length > 0) {
    return license.trim();
  }
  if (license && typeof license.type === 'string' && license.type.trim().length > 0) {
    return license.type.trim();
  }
  return 'UNKNOWN';
}
