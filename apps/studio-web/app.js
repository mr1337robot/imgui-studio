// Phase 2 web client: Monaco owns transient editor state, while every canonical read, revision,
// build, and preview identity comes from the authenticated local service.
const bootstrap = globalThis.__studioBootstrap;
if (!bootstrap?.token) throw new Error('The trusted service bootstrap token is missing.');

const elements = Object.fromEntries(
  [
    'project-name',
    'revision-status',
    'preview-status',
    'save-button',
    'build-button',
    'stale-indicator',
    'project-tree',
    'active-path',
    'editor-state',
    'build-status',
    'build-timing',
    'diagnostics',
    'preview',
    'preview-empty',
    'geometry-value',
    'restart-button',
    'play-button',
    'pause-button',
    'step-button',
    'speed-input',
    'seek-input',
    'seek-button',
    'inspect-button',
    'inspection-overlay',
  ].map((id) => [id, document.getElementById(id)]),
);

let project;
let activeFile;
let editor;
let suppressEditorChange = false;

await authorizePreviewOrigin();
await initializeProject();

let lastPreviewTimeUs = 0;
let lastToggleBounds = null;
const sendRuntimeCommand = (command) =>
  elements.preview.contentWindow?.postMessage(command, 'http://127.0.0.1:4174');
elements['restart-button'].addEventListener('click', () =>
  sendRuntimeCommand({ type: 'studio.runtime.reset' }),
);
elements['play-button'].addEventListener('click', () =>
  sendRuntimeCommand({ type: 'studio.runtime.play' }),
);
elements['pause-button'].addEventListener('click', () =>
  sendRuntimeCommand({ type: 'studio.runtime.render', timeUs: lastPreviewTimeUs }),
);
elements['step-button'].addEventListener('click', () =>
  sendRuntimeCommand({ type: 'studio.runtime.render', timeUs: lastPreviewTimeUs + 16_667 }),
);
elements['speed-input'].addEventListener('change', () =>
  sendRuntimeCommand({
    type: 'studio.runtime.speed',
    speed: Number(elements['speed-input'].value),
  }),
);
elements['seek-button'].addEventListener('click', () => {
  const timeUs = Number(elements['seek-input'].value);
  if (Number.isSafeInteger(timeUs) && timeUs >= 0) {
    if (timeUs < lastPreviewTimeUs) sendRuntimeCommand({ type: 'studio.runtime.reset' });
    sendRuntimeCommand({ type: 'studio.runtime.render', timeUs });
  }
});
elements['inspect-button'].addEventListener('click', () => {
  const enabled = elements['inspect-button'].getAttribute('aria-pressed') !== 'true';
  elements['inspect-button'].setAttribute('aria-pressed', String(enabled));
  elements['inspection-overlay'].hidden = !enabled || lastToggleBounds === null;
});

window.addEventListener('message', (event) => {
  if (event.origin !== 'http://127.0.0.1:4174' || event.source !== elements.preview.contentWindow)
    return;
  const message = event.data;
  if (!message || message.protocolVersion !== 1 || typeof message.type !== 'string') return;
  if (message.type === 'studio.preview.ready') {
    elements['preview-status'].textContent = 'Preview ready';
    elements['preview-status'].className = 'status status-ready';
  } else if (message.type === 'studio.preview.frame' && message.toggle) {
    lastPreviewTimeUs = message.clock?.timeUs ?? lastPreviewTimeUs;
    elements['seek-input'].value = String(lastPreviewTimeUs);
    const bounds = message.toggle;
    lastToggleBounds = bounds;
    Object.assign(elements['inspection-overlay'].style, {
      left: `${String(bounds.xPx)}px`,
      top: `${String(bounds.yPx)}px`,
      width: `${String(bounds.widthPx)}px`,
      height: `${String(bounds.heightPx)}px`,
    });
    elements['inspection-overlay'].hidden =
      elements['inspect-button'].getAttribute('aria-pressed') !== 'true';
    elements['geometry-value'].textContent =
      `${bounds.xPx.toFixed(1)}, ${bounds.yPx.toFixed(1)} · ${bounds.widthPx.toFixed(1)} × ${bounds.heightPx.toFixed(1)}`;
  }
});

elements['save-button'].addEventListener('click', () => void saveActiveFile());
elements['build-button'].addEventListener('click', () => void buildPreview());

async function initializeProject() {
  const listing = await api('/api/v1/projects');
  if (listing.projects.length !== 1) throw new Error('Phase 2 expects exactly one active project.');
  project = await api(`/api/v1/projects/${listing.projects[0].projectId}`);
  renderProjectState();
  renderProjectTree();
  await initializeMonaco();
  const preferred = project.files.find((file) => file.path === 'src/menu.cpp') ?? project.files[0];
  if (preferred) await openFile(preferred.path);
  if (project.currentPreview) await loadPreview(project.currentPreview);
}

async function initializeMonaco() {
  globalThis.require.config({ paths: { vs: '/vendor/monaco/vs' } });
  const monaco = await new Promise((resolvePromise) => {
    // The pinned Monaco AMD distribution packages the editor API and language contributions in one
    // reviewed local bundle. No CDN or runtime network dependency is permitted.
    globalThis.require(['vs/editor/editor.main'], () => resolvePromise(globalThis.monaco));
  });
  editor = monaco.editor.create(document.getElementById('editor'), {
    automaticLayout: true,
    fontFamily: 'Cascadia Code, Consolas, monospace',
    fontSize: 12,
    language: 'cpp',
    minimap: { enabled: false },
    padding: { top: 12 },
    scrollBeyondLastLine: false,
    theme: 'vs-dark',
  });
  editor.onDidChangeModelContent(() => {
    if (suppressEditorChange || !activeFile) return;
    elements['editor-state'].textContent =
      editor.getValue() === activeFile.content ? 'Clean' : 'Modified';
    elements['save-button'].disabled = editor.getValue() === activeFile.content;
  });
}

function renderProjectState() {
  elements['project-name'].textContent = project.name;
  elements['revision-status'].textContent = `Revision ${project.currentRevision}`;
  elements['build-button'].disabled = false;
  const stale = project.currentPreview?.projectRevision !== project.currentRevision;
  elements['stale-indicator'].hidden = !stale;
  if (stale) {
    elements['preview-status'].textContent = 'Working preview · stale';
    elements['preview-status'].className = 'status status-failed';
  }
}

function renderProjectTree() {
  elements['project-tree'].replaceChildren(
    ...project.files.map((file) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'file-button';
      button.textContent = file.path;
      button.title = file.path;
      button.dataset.path = file.path;
      button.addEventListener('click', () => void openFile(file.path));
      return button;
    }),
  );
}

async function openFile(path) {
  if (
    activeFile &&
    editor.getValue() !== activeFile.content &&
    !confirm('Discard unsaved editor changes?')
  )
    return;
  const response = await api(`/api/v1/projects/${project.projectId}/files:read`, {
    method: 'POST',
    body: { paths: [path], expectedRevision: project.currentRevision, includeContent: true },
  });
  activeFile = response.files[0];
  suppressEditorChange = true;
  editor.setValue(activeFile.content);
  suppressEditorChange = false;
  elements['active-path'].textContent = activeFile.path;
  elements['editor-state'].textContent = 'Clean';
  elements['save-button'].disabled = true;
  for (const button of elements['project-tree'].querySelectorAll('.file-button')) {
    button.classList.toggle('active', button.dataset.path === path);
  }
}

async function saveActiveFile() {
  const nextContent = editor.getValue();
  if (!activeFile || nextContent === activeFile.content) return;
  setBusy(true);
  try {
    const result = await api(`/api/v1/projects/${project.projectId}/files:patch`, {
      method: 'POST',
      mutation: true,
      body: {
        expectedRevision: project.currentRevision,
        patches: [
          {
            path: activeFile.path,
            expectedSha256: activeFile.sha256,
            unifiedDiff: createMinimalUnifiedDiff(activeFile.content, nextContent),
          },
        ],
        reason: 'Studio editor save',
      },
    });
    project.currentRevision = result.revision;
    activeFile = {
      ...activeFile,
      content: nextContent,
      sha256: result.postimageSha256[activeFile.path],
      revision: result.revision,
    };
    elements['editor-state'].textContent = 'Clean';
    renderProjectState();
  } catch (error) {
    showClientError(error);
  } finally {
    setBusy(false);
  }
}

async function buildPreview() {
  if (activeFile && editor.getValue() !== activeFile.content) await saveActiveFile();
  setBusy(true);
  clearDiagnostics();
  try {
    const start = await api(`/api/v1/projects/${project.projectId}/builds`, {
      method: 'POST',
      mutation: true,
      body: {
        expectedRevision: project.currentRevision,
        configuration: 'preview-debug',
        supersedeQueued: true,
      },
    });
    let build = start.build;
    while (!['succeeded', 'failed', 'cancelled'].includes(build.status)) {
      elements['build-status'].textContent = `Build ${build.status}…`;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
      ({ build } = await api(`/api/v1/projects/${project.projectId}/builds/${build.buildId}`));
    }
    renderBuild(build);
    if (build.status === 'succeeded') {
      project = await api(`/api/v1/projects/${project.projectId}`);
      renderProjectState();
      await loadPreview(project.currentPreview);
    } else {
      // The iframe is intentionally untouched on failure. Marking it stale tells the user that the
      // visible menu is still the last known-good build rather than the broken working revision.
      elements['stale-indicator'].hidden = false;
      elements['preview-status'].textContent = 'Last working preview · stale';
      elements['preview-status'].className = 'status status-failed';
    }
  } catch (error) {
    showClientError(error);
  } finally {
    setBusy(false);
  }
}

async function loadPreview(preview) {
  if (!preview) return;
  elements['preview-status'].textContent = 'Loading replacement…';
  elements['preview-status'].className = 'status status-loading';
  elements['preview-empty'].hidden = true;
  elements.preview.src = preview.url;
}

function renderBuild(build) {
  elements['build-status'].textContent = `Build ${build.status}`;
  const totalMs = Object.values(build.phaseDurationsMs).reduce((total, value) => total + value, 0);
  elements['build-timing'].textContent =
    `${Math.round(totalMs)} ms · stable cache ${build.cache.stableObjectsReused ? 'warm' : 'cold'}`;
  elements.diagnostics.replaceChildren(
    ...build.diagnostics.map((diagnostic) => {
      const item = document.createElement('li');
      item.textContent = `${diagnostic.relativePath ?? 'build'}:${diagnostic.line ?? 0}:${diagnostic.column ?? 0} ${diagnostic.code} ${diagnostic.message}`;
      return item;
    }),
  );
}

function createMinimalUnifiedDiff(before, after) {
  const oldLines = logicalLines(before);
  const newLines = logicalLines(after);
  let prefix = 0;
  while (
    prefix < oldLines.length &&
    prefix < newLines.length &&
    oldLines[prefix] === newLines[prefix]
  )
    prefix += 1;
  let suffix = 0;
  while (
    suffix < oldLines.length - prefix &&
    suffix < newLines.length - prefix &&
    oldLines[oldLines.length - suffix - 1] === newLines[newLines.length - suffix - 1]
  )
    suffix += 1;
  const contextStart = Math.max(0, prefix - 3);
  const oldChangeEnd = oldLines.length - suffix;
  const newChangeEnd = newLines.length - suffix;
  const trailingContext = Math.min(3, suffix);
  const oldEnd = oldChangeEnd + trailingContext;
  const newEnd = newChangeEnd + trailingContext;
  const oldCount = oldEnd - contextStart;
  const newCount = newEnd - contextStart;
  const body = [
    ...oldLines.slice(contextStart, prefix).map((line) => ` ${line}`),
    ...oldLines.slice(prefix, oldChangeEnd).map((line) => `-${line}`),
    ...newLines.slice(prefix, newChangeEnd).map((line) => `+${line}`),
    ...oldLines.slice(oldChangeEnd, oldEnd).map((line) => ` ${line}`),
  ];
  return `--- a/${activeFile.path}\n+++ b/${activeFile.path}\n@@ -${contextStart + 1},${oldCount} +${contextStart + 1},${newCount} @@\n${body.join('\n')}\n`;
}

function logicalLines(content) {
  const normalized = content.replaceAll('\r\n', '\n');
  const withoutTrailing = normalized.endsWith('\n') ? normalized.slice(0, -1) : normalized;
  return withoutTrailing.length === 0 ? [] : withoutTrailing.split('\n');
}

async function authorizePreviewOrigin() {
  const response = await fetch('http://127.0.0.1:4174/api/authorize', {
    method: 'POST',
    credentials: 'include',
    headers: { Authorization: `Bearer ${bootstrap.token}` },
  });
  if (!response.ok) throw new Error('Unable to authorize the isolated preview origin.');
}

async function api(path, options = {}) {
  const headers = { Accept: 'application/json' };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.mutation) {
    headers.Authorization = `Bearer ${bootstrap.token}`;
    headers['Idempotency-Key'] = crypto.randomUUID();
  }
  const response = await fetch(path, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const body = await response.json();
  if (!response.ok)
    throw new Error(
      `${body.error?.code ?? response.status}: ${body.error?.message ?? 'Request failed'}`,
    );
  return body;
}

function setBusy(busy) {
  elements['build-button'].disabled = busy;
  elements['save-button'].disabled =
    busy || !activeFile || editor.getValue() === activeFile.content;
}

function clearDiagnostics() {
  elements.diagnostics.replaceChildren();
  elements['build-timing'].textContent = '';
}

function showClientError(error) {
  elements['build-status'].textContent =
    error instanceof Error ? error.message : 'Unexpected client error.';
}
