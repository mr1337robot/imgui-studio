import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import pngjs from 'pngjs';

const { PNG } = pngjs;
const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const outputRoot = resolve(repositoryRoot, 'out/browser-test');
mkdirSync(outputRoot, { recursive: true });

// Reuse an explicitly started development server, but own and clean up a child server when the
// test starts one. This keeps the test convenient locally without leaving background processes in CI.
let server;
if (!(await responds('http://127.0.0.1:4173'))) {
  server = spawn(process.execPath, [resolve(repositoryRoot, 'scripts/serve-preview.mjs')], {
    cwd: repositoryRoot,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  await waitForServer(server);
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1220, height: 760 } });
const browserErrors = [];
page.on('pageerror', (error) => browserErrors.push(error.message));
page.on('console', (message) => {
  if (message.type() === 'error') {
    browserErrors.push(message.text());
  }
});

try {
  await page.goto('http://127.0.0.1:4173', { waitUntil: 'domcontentloaded' });
  await page.locator('#preview-status').getByText('Preview ready').waitFor({ timeout: 15_000 });

  const sandbox = await page.locator('#preview').getAttribute('sandbox');
  assert(sandbox === 'allow-scripts allow-same-origin', `Unexpected iframe sandbox: ${sandbox}`);
  assert(
    await page.locator('#renderer-value').getByText('webgl2').isVisible(),
    'Renderer status did not report WebGL2.',
  );

  const previewFrame = page
    .frames()
    .find((frame) => frame.url().startsWith('http://127.0.0.1:4174/'));
  assert(previewFrame, 'Dedicated preview frame was not found.');
  await previewFrame.locator('#canvas').waitFor({ state: 'visible' });
  const initialFrame = await previewFrame.evaluate(() => globalThis.__studioLastFrame);
  assert(initialFrame?.protocolVersion === 1, 'Preview frame protocol version was not v1.');
  assert(initialFrame?.renderer === 'webgl2', 'Preview frame renderer was not WebGL2.');
  assert(initialFrame?.toggle?.enabled === true, 'Starter toggle did not begin enabled.');
  assert(
    initialFrame.viewport.widthPx === 900 && initialFrame.viewport.heightPx === 600,
    'Canonical browser viewport was not 900 x 600.',
  );

  // A wrong protocol version represents an untrusted/stale agent request. The preview must ignore
  // it without changing capture state or destabilizing the render loop.
  await page.locator('#preview').evaluate((preview) => {
    preview.contentWindow.postMessage(
      { protocolVersion: 999, type: 'studio.capture.request', requestId: 'malformed' },
      'http://127.0.0.1:4174',
    );
  });
  await previewFrame.waitForTimeout(50);
  assert(
    (await previewFrame.evaluate(() => globalThis.__studioCaptureRequest)) === null,
    'Preview accepted a malformed protocol request.',
  );

  await previewFrame
    .locator('#canvas')
    .screenshot({ path: resolve(outputRoot, 'canvas-initial.png') });
  await page.screenshot({ path: resolve(outputRoot, 'studio-shell.png'), fullPage: true });

  // Click from structured geometry rather than a hard-coded screen coordinate. This exercises the
  // same inspect-then-target workflow an agent will use and catches stale coordinate metadata.
  const toggle = initialFrame.toggle;
  await previewFrame.locator('#canvas').click({
    position: { x: toggle.xPx + toggle.widthPx / 2, y: toggle.yPx + toggle.heightPx / 2 },
  });
  await previewFrame.waitForFunction(() => globalThis.__studioLastFrame?.toggle?.enabled === false);
  await previewFrame.waitForTimeout(250);
  const toggledFrame = await previewFrame.evaluate(() => globalThis.__studioLastFrame);
  assert(
    toggledFrame.toggle.progress < 0.25,
    'Toggle animation did not approach the disabled state.',
  );
  await previewFrame
    .locator('#canvas')
    .screenshot({ path: resolve(outputRoot, 'canvas-toggled.png') });

  await previewFrame.locator('#canvas').click({
    position: { x: toggle.xPx + toggle.widthPx / 2, y: toggle.yPx + toggle.heightPx / 2 },
  });
  await previewFrame.waitForFunction(() => globalThis.__studioLastFrame?.toggle?.enabled === true);
  await previewFrame.waitForTimeout(300);

  // Use the public Studio control for canonical capture; a Playwright canvas screenshot would
  // include browser presentation behavior rather than the explicit WebGL readback path.
  await page.locator('#capture-button').click();
  await page
    .locator('#capture-status')
    .getByText('Saved out/captures/browser.png')
    .waitFor({ timeout: 10_000 });

  const capturePath = resolve(repositoryRoot, 'out/captures/browser.png');
  const metadataPath = resolve(repositoryRoot, 'out/captures/browser.metadata.json');
  assert(existsSync(capturePath), 'Canonical browser PNG was not saved.');
  assert(existsSync(metadataPath), 'Canonical browser metadata was not saved.');
  const capture = PNG.sync.read(readFileSync(capturePath));
  assert(
    capture.width === 900 && capture.height === 600,
    'Browser PNG dimensions were not 900 x 600.',
  );
  const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'));
  assert(metadata.renderer === 'webgl2', 'Browser metadata renderer was not WebGL2.');
  assert(
    /^[a-f0-9]{64}$/.test(metadata.sourceSha256),
    'Browser metadata did not contain the shared starter source identity.',
  );
  assert(
    metadata.toggle.widthPx === 58 && metadata.toggle.heightPx === 30,
    'Browser metadata did not contain canonical toggle geometry.',
  );

  assert(browserErrors.length === 0, `Browser emitted errors:\n${browserErrors.join('\n')}`);
  console.log('Browser preview handshake, interaction, animation, isolation, and capture passed.');
} catch (error) {
  await page.screenshot({ path: resolve(outputRoot, 'failure.png'), fullPage: true });
  console.error(`Browser console/page errors:\n${browserErrors.join('\n') || '(none captured)'}`);
  throw error;
} finally {
  await browser.close();
  if (server) {
    server.kill();
  }
}

async function responds(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(500) });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForServer(child) {
  let output = '';
  child.stdout.on('data', (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    output += chunk.toString();
  });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await responds('http://127.0.0.1:4173')) {
      return;
    }
    if (child.exitCode !== null) {
      throw new Error(`Preview server exited before startup:\n${output}`);
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
  }
  throw new Error(`Preview server did not start in time:\n${output}`);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
