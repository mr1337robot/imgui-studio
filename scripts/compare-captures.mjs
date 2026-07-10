import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  compareGeometry,
  comparePngFiles,
  compareSourceIdentity,
} from './lib/capture-comparison.mjs';

// This CLI is the composition layer for the parity gate. The comparison library stays pure apart
// from image I/O, while this file owns argument defaults, artifact paths, report shape, and exit code.
const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const argumentsByName = parseArguments(process.argv.slice(2));
const browserImage = resolve(
  repositoryRoot,
  argumentsByName.get('--browser-image') ?? 'out/captures/browser.png',
);
const nativeImage = resolve(
  repositoryRoot,
  argumentsByName.get('--native-image') ?? 'out/captures/native.png',
);
const browserMetadataPath = resolve(
  repositoryRoot,
  argumentsByName.get('--browser-metadata') ?? 'out/captures/browser.metadata.json',
);
const nativeMetadataPath = resolve(
  repositoryRoot,
  argumentsByName.get('--native-metadata') ?? 'out/captures/native.metadata.json',
);
const reportPath = resolve(
  repositoryRoot,
  argumentsByName.get('--report') ?? 'out/comparison/phase1.report.json',
);
const differencePath = resolve(
  repositoryRoot,
  argumentsByName.get('--difference') ?? 'out/comparison/phase1.difference.png',
);
const expectFailure = argumentsByName.has('--expect-failure');

const browserMetadata = JSON.parse(readFileSync(browserMetadataPath, 'utf8'));
const nativeMetadata = JSON.parse(readFileSync(nativeMetadataPath, 'utf8'));
const geometry = compareGeometry(browserMetadata, nativeMetadata, 2);
const sourceIdentity = compareSourceIdentity(browserMetadata, nativeMetadata);
mkdirSync(dirname(differencePath), { recursive: true });
const pixels = comparePngFiles(browserImage, nativeImage, differencePath);
const report = {
  schemaVersion: 1,
  gate: 'phase1.browser-native-parity',
  browserImage: relativePath(browserImage),
  nativeImage: relativePath(nativeImage),
  differenceImage: relativePath(differencePath),
  geometry,
  sourceIdentity,
  pixels,
  passed: sourceIdentity.passed && geometry.passed && pixels.passedDimensions,
};
mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));

// Negative CI fixtures use --expect-failure: their successful outcome is a rejected parity report.
// Invert only the process exit condition; never rewrite `report.passed`, which describes the actual
// comparison and must remain truthful for artifact consumers.
if (expectFailure ? report.passed : !report.passed) {
  process.exitCode = 1;
}

function parseArguments(values) {
  // Parse a deliberately tiny `--name value` grammar. Rejecting ambiguity is safer than accepting
  // positional values that could cause the gate to compare the wrong artifacts.
  const parsed = new Map();
  for (let index = 0; index < values.length; index += 1) {
    const key = values[index];
    if (key === '--expect-failure') {
      parsed.set(key, true);
      continue;
    }
    const value = values[index + 1];
    if (!key?.startsWith('--') || !value || value.startsWith('--')) {
      throw new Error(`Invalid comparison argument near '${key ?? ''}'.`);
    }
    parsed.set(key, value);
    index += 1;
  }
  return parsed;
}

function relativePath(path) {
  // Reports use repository-relative protocol paths so artifacts remain portable across CI hosts.
  return path.slice(repositoryRoot.length).replaceAll('\\', '/').replace(/^\//, '');
}
