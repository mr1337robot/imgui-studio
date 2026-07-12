/**
 * Initializes and audits the external ten-run release benchmark evidence bundle.
 *
 * This script never performs or invents agent attempts and human reviews. It gives those external
 * activities a deterministic, machine-checkable envelope and fails closed when evidence is absent.
 */
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const contractPath = resolve(repositoryRoot, 'benchmarks/neon-reference/benchmark.json');
const command = process.argv[2];

if (command === 'init') await initialize(process.argv[3]);
else if (command === 'audit') await audit(process.argv[3]);
else throw new Error('Usage: benchmark-evaluation.mjs <init|audit> [bundle-directory]');

async function initialize(requestedDirectory) {
  const contract = await readJson(contractPath);
  const bundleRoot = resolve(
    requestedDirectory ??
      resolve(repositoryRoot, 'out/benchmark-evaluation', `eval_${randomUUID()}`),
  );
  await mkdir(resolve(bundleRoot, 'runs'), { recursive: true });
  const contractSha256 = digest(await readFile(contractPath));
  await writeJson(resolve(bundleRoot, 'evaluation.json'), {
    schemaVersion: 1,
    benchmarkId: contract.benchmarkId,
    contractSha256,
    runCount: contract.attemptCount,
    status: 'pending',
  });
  for (let index = 1; index <= contract.attemptCount; index += 1) {
    const runId = `run-${String(index).padStart(2, '0')}`;
    const runRoot = resolve(bundleRoot, 'runs', runId);
    await mkdir(runRoot, { recursive: true });
    await writeJson(resolve(runRoot, 'run.json'), runTemplate(runId));
  }
  console.log(bundleRoot);
}

async function audit(requestedDirectory) {
  if (!requestedDirectory) throw new Error('Audit requires an evaluation bundle directory.');
  const bundleRoot = resolve(requestedDirectory);
  const contract = await readJson(contractPath);
  const evaluation = await readJson(resolve(bundleRoot, 'evaluation.json'));
  const failures = [];
  if (evaluation.benchmarkId !== contract.benchmarkId) failures.push('benchmarkId mismatch');
  if (evaluation.contractSha256 !== digest(await readFile(contractPath))) {
    failures.push('benchmark contract digest mismatch');
  }
  const runs = [];
  for (let index = 1; index <= contract.attemptCount; index += 1) {
    const runId = `run-${String(index).padStart(2, '0')}`;
    try {
      const run = await readJson(resolve(bundleRoot, 'runs', runId, 'run.json'));
      runs.push(run);
      validateRun(run, runId, contract, failures);
    } catch (error) {
      failures.push(`${runId}: ${error instanceof Error ? error.message : 'unreadable evidence'}`);
    }
  }
  const completed = runs.filter((run) => technicalPass(run, contract));
  const highQuality = completed.filter(
    (run) => overallRating(run) >= contract.minimumOverallRating,
  );
  const deterministicAttempts = completed.filter((run) => run.technical.deterministicThreeRepeats);
  const deterministicPercent = completed.length
    ? (deterministicAttempts.length * 100) / completed.length
    : 0;
  if (completed.length < contract.minimumCompletedRuns) failures.push('completion target missed');
  if (highQuality.length < contract.minimumHighQualityRuns)
    failures.push('visual-quality target missed');
  if (deterministicPercent < contract.minimumDeterministicPercent) {
    failures.push('determinism target missed');
  }
  const summary = {
    schemaVersion: 1,
    benchmarkId: contract.benchmarkId,
    status: failures.length === 0 ? 'passed' : 'failed',
    attemptedRuns: runs.length,
    completedRuns: completed.length,
    highQualityRuns: highQuality.length,
    deterministicPercent,
    failures,
  };
  await writeJson(resolve(bundleRoot, 'summary.json'), summary);
  console.log(JSON.stringify(summary, null, 2));
  if (failures.length > 0) process.exitCode = 1;
}

function validateRun(run, runId, contract, failures) {
  if (run.runId !== runId) failures.push(`${runId}: runId mismatch`);
  if (run.humanSourceEdits !== false)
    failures.push(`${runId}: human source edits present or undeclared`);
  if (!Array.isArray(run.toolTrace) || run.toolTrace.length === 0)
    failures.push(`${runId}: tool trace absent`);
  const disallowed = (run.toolTrace ?? []).filter(
    (entry) => !contract.permittedTools.includes(entry.tool),
  );
  if (disallowed.length > 0) failures.push(`${runId}: disallowed tool recorded`);
  if (!technicalPass(run, contract)) failures.push(`${runId}: technical gate failed`);
  const reviews = run.reviews ?? [];
  if (reviews.length < 2) failures.push(`${runId}: fewer than two blinded reviews`);
  for (const review of reviews) {
    if (!review.reviewerId || !review.rationale)
      failures.push(`${runId}: incomplete review attribution`);
    for (const dimension of contract.humanDimensions) {
      const score = review.scores?.[dimension];
      if (!Number.isInteger(score) || score < 1 || score > 5) {
        failures.push(`${runId}: invalid ${dimension} score`);
      }
    }
  }
  if (ratingSpread(reviews) > 1 && !run.adjudication?.rationale) {
    failures.push(`${runId}: reviewer disagreement requires adjudication`);
  }
}

function technicalPass(run, contract) {
  const technical = run.technical ?? {};
  return (
    run.status === 'completed' &&
    contract.requiredControls.every((control) => technical.controls?.[control] === true) &&
    contract.requiredAnimationStates.every((state) => technical.animations?.[state] === true) &&
    technical.stableIdentifiers === true &&
    technical.inspectionDiagnostics === 0 &&
    technical.scenariosPassed === true &&
    technical.deterministicThreeRepeats === true &&
    technical.exportVerified === true &&
    Number.isFinite(technical.geometryMaximumDifferencePx) &&
    technical.geometryMaximumDifferencePx <= contract.maximumGeometryDifferencePx
  );
}

function overallRating(run) {
  const scores = (run.reviews ?? [])
    .map((review) => review.scores?.overall)
    .filter(Number.isFinite);
  return scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : 0;
}

function ratingSpread(reviews) {
  const scores = reviews.map((review) => review.scores?.overall).filter(Number.isFinite);
  return scores.length ? Math.max(...scores) - Math.min(...scores) : 0;
}

function runTemplate(runId) {
  return {
    schemaVersion: 1,
    runId,
    status: 'pending',
    agent: { provider: '', model: '', configuration: '', resourceBudget: '' },
    humanSourceEdits: null,
    timingsMs: { firstSuccessfulPreview: null, acceptedExport: null, total: null },
    counts: { patches: 0, builds: 0, visualIterations: 0, buildFailures: 0 },
    toolTrace: [],
    technical: {
      controls: {},
      animations: {},
      stableIdentifiers: false,
      inspectionDiagnostics: null,
      scenariosPassed: false,
      deterministicThreeRepeats: false,
      exportVerified: false,
      geometryMaximumDifferencePx: null,
    },
    artifacts: {
      capture: '',
      filmstrip: '',
      parityReport: '',
      exportReport: '',
      portabilityReport: '',
    },
    failureClassification: null,
    reviews: [],
    adjudication: null,
  };
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}
