const previewOrigin = 'http://127.0.0.1:4174';
const iframe = document.querySelector('#preview');
const status = document.querySelector('#preview-status');
const renderer = document.querySelector('#renderer-value');
const geometry = document.querySelector('#geometry-value');
const captureButton = document.querySelector('#capture-button');
const captureStatus = document.querySelector('#capture-status');
let lastFrame = null;

window.addEventListener('message', async (event) => {
  if (event.origin !== previewOrigin || event.source !== iframe.contentWindow) return;
  const message = event.data;
  if (!message || message.protocolVersion !== 1 || typeof message.type !== 'string') return;
  if (message.type === 'studio.preview.ready') {
    status.textContent = 'Preview ready';
    renderer.textContent = message.renderer;
    captureButton.disabled = false;
  } else if (message.type === 'studio.preview.frame') {
    lastFrame = message;
    geometry.textContent = JSON.stringify(message.toggle);
  } else if (message.type === 'studio.capture.completed') {
    await saveCapture(message);
  }
});

captureButton.addEventListener('click', () => {
  captureButton.disabled = true;
  iframe.contentWindow.postMessage(
    { protocolVersion: 1, type: 'studio.capture.request', requestId: crypto.randomUUID() },
    previewOrigin,
  );
});

async function saveCapture(message) {
  const response = await fetch('/api/captures/browser', {
    method: 'POST',
    headers: {
      'Content-Type': 'image/png',
      'X-Studio-Metadata': btoa(JSON.stringify(message.frame ?? lastFrame)),
    },
    body: message.bytes,
  });
  captureStatus.textContent = response.ok
    ? 'Saved out/captures/browser.png'
    : `Capture save failed (${response.status}).`;
  captureButton.disabled = false;
}
