// The Studio shell is presentation-only in Phase 1. It observes the isolated preview protocol and
// asks the local capture endpoint to persist artifacts; it does not own project or build state.
const previewOrigin = 'http://127.0.0.1:4174';
const iframe = document.querySelector('#preview');
const status = document.querySelector('#preview-status');
const renderer = document.querySelector('#renderer-value');
const geometry = document.querySelector('#geometry-value');
const captureButton = document.querySelector('#capture-button');
const captureStatus = document.querySelector('#capture-status');

let lastFrame = null;

window.addEventListener('message', async (event) => {
  // postMessage payloads are untrusted even on localhost: an unrelated page can attempt to contact
  // the service. Require both the dedicated origin and the exact iframe Window before inspecting
  // the versioned message envelope.
  if (event.origin !== previewOrigin || event.source !== iframe.contentWindow) {
    return;
  }
  const message = event.data;
  if (!message || message.protocolVersion !== 1 || typeof message.type !== 'string') {
    return;
  }

  if (message.type === 'studio.preview.ready') {
    status.textContent = 'Preview ready';
    status.classList.remove('status-loading');
    status.classList.add('status-ready');
    renderer.textContent = message.renderer;
    captureButton.disabled = false;
  } else if (message.type === 'studio.preview.frame') {
    lastFrame = message;
    const toggle = message.toggle;
    geometry.textContent = `${toggle.xPx.toFixed(1)}, ${toggle.yPx.toFixed(1)} · ${toggle.widthPx.toFixed(1)} × ${toggle.heightPx.toFixed(1)}`;
  } else if (message.type === 'studio.capture.completed') {
    await saveCapture(message);
  } else if (message.type === 'studio.capture.failed') {
    captureStatus.textContent = 'Capture failed in preview.';
    captureButton.disabled = false;
  }
});

captureButton.addEventListener('click', () => {
  // Target a concrete origin rather than "*" so capture requests cannot be delivered if the frame
  // is navigated away from the dedicated preview server.
  captureButton.disabled = true;
  captureStatus.textContent = 'Capturing canonical framebuffer…';
  iframe.contentWindow.postMessage(
    {
      protocolVersion: 1,
      type: 'studio.capture.request',
      requestId: crypto.randomUUID(),
    },
    previewOrigin,
  );
});

async function saveCapture(message) {
  // Capture bytes are transferred from the iframe as an ArrayBuffer. The frame snapshot travels
  // beside them so the PNG is never persisted without the geometry/provenance it represents.
  const metadata = message.frame ?? lastFrame;
  if (!metadata || !(message.bytes instanceof ArrayBuffer)) {
    captureStatus.textContent = 'Capture response was incomplete.';
    captureButton.disabled = false;
    return;
  }

  // Phase 1 uses a bounded loopback endpoint. The metadata header is base64 because request header
  // values cannot safely carry arbitrary JSON characters; the server decodes and validates it.
  const response = await fetch('/api/captures/browser', {
    method: 'POST',
    headers: {
      'Content-Type': 'image/png',
      'X-Studio-Metadata': btoa(JSON.stringify(metadata)),
    },
    body: message.bytes,
  });
  if (!response.ok) {
    captureStatus.textContent = `Capture save failed (${response.status}).`;
  } else {
    captureStatus.textContent = 'Saved out/captures/browser.png';
  }
  captureButton.disabled = false;
}
