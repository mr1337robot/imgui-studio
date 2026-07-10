import { createServer } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// This intentionally small Phase 1 host serves two origins: the Studio shell and the compiled
// preview. Origin separation lets the iframe CSP remain restrictive and exercises the same trust
// boundary that the later local service will enforce. It is not the Phase 2 project service.
const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const studioRoot = resolve(repositoryRoot, 'apps/studio-web');
const previewRoot = resolve(repositoryRoot, 'build/wasm-preview/preview');
const captureRoot = resolve(repositoryRoot, 'out/captures');
const maximumCaptureBytes = 16 * 1024 * 1024;

const studioServer = createServer((request, response) => {
  if (request.method === 'POST' && request.url === '/api/captures/browser') {
    receiveCapture(request, response);
    return;
  }
  serveStatic(request, response, studioRoot, {
    'Content-Security-Policy':
      "default-src 'self'; script-src 'self'; style-src 'self'; frame-src http://127.0.0.1:4174; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'",
  });
});

const previewServer = createServer((request, response) => {
  serveStatic(request, response, previewRoot, {
    'Access-Control-Allow-Origin': 'http://127.0.0.1:4173',
    'Content-Security-Policy':
      "default-src 'none'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data: blob:; font-src 'self'; base-uri 'none'; form-action 'none'",
  });
});

studioServer.listen(4173, '127.0.0.1', () => {
  console.log('Studio shell: http://127.0.0.1:4173');
});
previewServer.listen(4174, '127.0.0.1', () => {
  console.log('Dedicated preview: http://127.0.0.1:4174');
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    studioServer.close();
    previewServer.close();
  });
}

function serveStatic(request, response, root, extraHeaders) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405).end();
    return;
  }
  const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
  const relativePath = requestUrl.pathname === '/' ? 'index.html' : requestUrl.pathname.slice(1);
  const filePath = resolve(root, relativePath);
  const rootPrefix = root.endsWith(sep) ? root : root + sep;
  // resolve() collapses `..` segments. Requiring the final absolute path to retain the configured
  // root prefix confines ordinary traversal attempts to the selected static tree. Phase 2 adds the
  // stronger reparse-point/symlink checks required for user-controlled project files.
  if (!filePath.startsWith(rootPrefix)) {
    response.writeHead(404).end();
    return;
  }

  let bytes;
  try {
    bytes = readFileSync(filePath);
  } catch {
    response.writeHead(404, extraHeaders).end('Not found');
    return;
  }
  const headers = {
    ...extraHeaders,
    'Cache-Control': 'no-store',
    'Content-Type': mediaType(filePath),
    'Cross-Origin-Resource-Policy': 'same-origin',
    'X-Content-Type-Options': 'nosniff',
  };
  response.writeHead(200, headers);
  if (request.method === 'HEAD') {
    response.end();
  } else {
    response.end(bytes);
  }
}

function receiveCapture(request, response) {
  // Both metadata and image bytes cross from browser code into a filesystem-writing endpoint.
  // Bound them independently before decoding or buffering to prevent a localhost memory sink.
  const metadataHeader = request.headers['x-studio-metadata'];
  if (typeof metadataHeader !== 'string' || metadataHeader.length > 16_384) {
    response.writeHead(400).end('Invalid metadata');
    return;
  }

  const chunks = [];
  let size = 0;
  request.on('data', (chunk) => {
    size += chunk.length;
    if (size > maximumCaptureBytes) {
      // Destroying the request stops the producer immediately instead of continuing to buffer data
      // that is already known to be invalid.
      request.destroy();
      return;
    }
    chunks.push(chunk);
  });
  request.on('end', () => {
    if (size === 0 || size > maximumCaptureBytes) {
      response.writeHead(413).end('Capture size rejected');
      return;
    }
    let metadata;
    try {
      metadata = JSON.parse(Buffer.from(metadataHeader, 'base64').toString('utf8'));
    } catch {
      response.writeHead(400).end('Metadata decode failed');
      return;
    }
    // Accept only the canonical Phase 1 framebuffer. This is intentionally narrower than the
    // schema because the comparison fixture must not silently capture a scaled viewport.
    if (
      metadata?.protocolVersion !== 1 ||
      metadata?.renderer !== 'webgl2' ||
      metadata?.viewport?.widthPx !== 900 ||
      metadata?.viewport?.heightPx !== 600
    ) {
      response.writeHead(400).end('Metadata contract rejected');
      return;
    }

    // Output filenames are fixed by the service rather than derived from request data, so callers
    // cannot select an arbitrary filesystem destination.
    mkdirSync(captureRoot, { recursive: true });
    writeFileSync(resolve(captureRoot, 'browser.png'), Buffer.concat(chunks));
    writeFileSync(
      resolve(captureRoot, 'browser.metadata.json'),
      `${JSON.stringify({ schemaVersion: 1, ...metadata }, null, 2)}\n`,
    );
    response.writeHead(201, { 'Content-Type': 'application/json' });
    response.end('{"saved":true}');
  });
}

function mediaType(path) {
  switch (extname(path)) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.js':
      return 'text/javascript; charset=utf-8';
    case '.wasm':
      return 'application/wasm';
    case '.css':
      return 'text/css; charset=utf-8';
    default:
      return 'application/octet-stream';
  }
}
