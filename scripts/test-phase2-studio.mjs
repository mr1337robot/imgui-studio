import { spawn } from 'node:child_process';
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const outputRoot = resolve(repositoryRoot, 'out/phase2-studio-test');
const projectRoot = resolve(outputRoot, 'project');
rmSync(outputRoot, { recursive: true, force: true });
mkdirSync(outputRoot, { recursive: true });
cpSync(resolve(repositoryRoot, 'examples/starter'), projectRoot, {
  recursive: true,
  filter: (source) => !source.includes(resolve(repositoryRoot, 'examples/starter/.studio')),
});
rmSync(resolve(projectRoot, '.studio'), { recursive: true, force: true });

const service = spawn(
  process.execPath,
  [
    resolve(repositoryRoot, 'node_modules/tsx/dist/cli.mjs'),
    resolve(repositoryRoot, 'apps/studio-service/src/main.ts'),
    '--workspace',
    projectRoot,
  ],
  {
    cwd: repositoryRoot,
    env: process.env,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  },
);

let serviceOutput = '';
service.stdout.on('data', (chunk) => (serviceOutput += chunk.toString()));
service.stderr.on('data', (chunk) => (serviceOutput += chunk.toString()));
await waitForService();

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1800, height: 900 } });
const browserErrors = [];
page.on('pageerror', (error) => browserErrors.push(error.stack ?? error.message));
page.on('console', (message) => {
  if (message.type() === 'error') browserErrors.push(message.text());
});

try {
  const response = await page.goto('http://127.0.0.1:4173', { waitUntil: 'domcontentloaded' });
  assert(
    response?.headers()['content-security-policy']?.includes("frame-ancestors 'none'"),
    'Studio response did not include its restrictive CSP.',
  );
  await page.getByText('ImGui Studio Starter').waitFor();
  await page.locator('.monaco-editor').waitFor({ timeout: 15_000 });
  await page.getByRole('button', { name: 'src/menu.cpp' }).click();
  await page.waitForFunction(() =>
    globalThis.monaco?.editor.getModels()[0]?.getValue().includes('duration = 0.22'),
  );

  // Drive a real Monaco edit through the public UI. Build preview saves the revision first, then
  // waits for the cached build and smoke-gated replacement preview.
  await setEditorText('duration = 0.22', 'duration = 0.24');
  await page.getByRole('button', { name: 'Build preview' }).click();
  await page.getByText('Build succeeded', { exact: true }).waitFor({ timeout: 60_000 });
  await page.getByText('Preview ready', { exact: true }).waitFor({ timeout: 15_000 });
  const workingPreviewUrl = await page.locator('#preview').getAttribute('src');
  assert(
    workingPreviewUrl?.includes('projectRevision=1'),
    'Successful UI build loaded wrong revision.',
  );
  await page.screenshot({
    path: resolve(outputRoot, 'successful-edit-build-preview.png'),
    fullPage: true,
  });

  // Introduce a compiler error. The build must fail visibly while the successful iframe URL stays
  // untouched and receives an explicit stale marker.
  await setEditorText('duration = 0.24', 'duration =');
  await page.getByRole('button', { name: 'Build preview' }).click();
  await page.getByText('Build failed', { exact: true }).waitFor({ timeout: 60_000 });
  await page.getByText('PREVIEW STALE', { exact: true }).waitFor();
  assert(
    (await page.locator('#preview').getAttribute('src')) === workingPreviewUrl,
    'Compiler failure replaced the last known-good iframe.',
  );
  await page.screenshot({
    path: resolve(outputRoot, 'failed-build-stale-preview.png'),
    fullPage: true,
  });
  assert(browserErrors.length === 0, `Studio browser errors:\n${browserErrors.join('\n')}`);
  console.log('Phase 2 Monaco edit, build, replacement, diagnostics, and stale-preview UI passed.');
} catch (error) {
  await page.screenshot({ path: resolve(outputRoot, 'failure.png'), fullPage: true });
  console.error(`Studio service output:\n${serviceOutput || '(none)'}`);
  console.error(`Studio browser errors:\n${browserErrors.join('\n') || '(none)'}`);
  throw error;
} finally {
  await browser.close();
  service.kill('SIGTERM');
}

async function setEditorText(before, after) {
  const changed = await page.evaluate(
    ({ beforeText, afterText }) => {
      const model = globalThis.monaco.editor.getModels()[0];
      const current = model.getValue();
      if (!current.includes(beforeText)) return false;
      model.setValue(current.replace(beforeText, afterText));
      return true;
    },
    { beforeText: before, afterText: after },
  );
  assert(changed, `Editor fixture text was not found: ${before}`);
}

async function waitForService() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (service.exitCode !== null)
      throw new Error(`Studio service exited early:\n${serviceOutput}`);
    try {
      const response = await fetch('http://127.0.0.1:4173/api/v1/projects');
      if (response.ok) return;
    } catch {
      // Listener startup is asynchronous; retry within the bounded five-second window.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
  }
  throw new Error(`Studio service did not start:\n${serviceOutput}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
