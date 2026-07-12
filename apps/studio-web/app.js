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
    'theme-editor',
    'theme-accent',
    'theme-duration',
    'theme-apply',
    'theme-status',
  ].map((id) => [id, document.getElementById(id)]),
);

let project;
let activeFile;
let editor;
let suppressEditorChange = false;
let managedTheme;

await authorizePreviewOrigin();
await initializeProject();

elements['theme-apply'].addEventListener('click', () => void applyManagedTheme());
for (const input of [elements['theme-accent'], elements['theme-duration']]) {
  input.addEventListener('input', () => {
    elements['theme-apply'].disabled = managedTheme === undefined;
  });
}

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
  await initializeManagedThemeEditor();
  const preferred = project.files.find((file) => file.path === 'src/menu.cpp') ?? project.files[0];
  if (preferred) await openFile(preferred.path);
  if (project.currentPreview) await loadPreview(project.currentPreview);
}

/**
 * Loads the explicit Studio-managed token file into a deliberately small property editor.
 *
 * The editor is intentionally not a general C++ parser or a replacement for Monaco. It recognizes
 * only the two stable starter token expressions below and writes only the manifest-declared managed
 * source file through the normal revision/preimage patch protocol.
 */
async function initializeManagedThemeEditor() {
  const path = 'src/studio_managed_theme.cpp';
  if (!project.files.some((file) => file.path === path)) return;
  const response = await api(`/api/v1/projects/${project.projectId}/files:read`, {
    method: 'POST',
    body: { paths: [path], expectedRevision: project.currentRevision, includeContent: true },
  });
  const file = response.files[0];
  const tokens = parseManagedTheme(file.content);
  if (!tokens) return;
  managedTheme = { ...file, ...tokens };
  elements['theme-accent'].value = tokens.accentHex;
  elements['theme-duration'].value = String(tokens.durationSeconds);
  elements['theme-editor'].hidden = false;
  elements['theme-apply'].disabled = false;
  elements['theme-status'].textContent = 'Edits only src/studio_managed_theme.cpp.';
}

function parseManagedTheme(content) {
  const accent = /\.accent\s*=\s*IM_COL32\((\d+),\s*(\d+),\s*(\d+),\s*(\d+)\)/.exec(content);
  const duration = /\.animationDurationSeconds\s*=\s*([0-9]+(?:\.[0-9]+)?)F/.exec(content);
  if (!accent || !duration) return null;
  const channels = accent.slice(1, 5).map(Number);
  if (channels.some((channel) => !Number.isInteger(channel) || channel < 0 || channel > 255))
    return null;
  const durationSeconds = Number(duration[1]);
  if (!Number.isFinite(durationSeconds) || durationSeconds < 0 || durationSeconds > 2) return null;
  return {
    accentHex: `#${channels
      .slice(0, 3)
      .map((channel) => channel.toString(16).padStart(2, '0'))
      .join('')}`,
    durationSeconds,
  };
}

async function applyManagedTheme() {
  if (!managedTheme) return;
  const durationSeconds = Number(elements['theme-duration'].value);
  if (!Number.isFinite(durationSeconds) || durationSeconds < 0 || durationSeconds > 2) {
    elements['theme-status'].textContent = 'Motion must be a finite value from 0 to 2 seconds.';
    return;
  }
  const [red, green, blue] = hexChannels(elements['theme-accent'].value);
  const next = managedTheme.content
    .replace(
      /(\.accent\s*=\s*)IM_COL32\([^)]*\)(,)/,
      `$1IM_COL32(${red}, ${green}, ${blue}, 255)$2`,
    )
    .replace(
      /(\.animationDurationSeconds\s*=\s*)[0-9]+(?:\.[0-9]+)?F(,)/,
      `$1${durationSeconds.toFixed(2)}F$2`,
    );
  if (next === managedTheme.content) {
    elements['theme-status'].textContent = 'Managed theme tokens could not be located safely.';
    return;
  }
  setBusy(true);
  try {
    const result = await api(`/api/v1/projects/${project.projectId}/files:patch`, {
      method: 'POST',
      mutation: true,
      body: {
        expectedRevision: project.currentRevision,
        patches: [
          {
            path: managedTheme.path,
            expectedSha256: managedTheme.sha256,
            unifiedDiff: createMinimalUnifiedDiff(managedTheme.content, next, managedTheme.path),
          },
        ],
        reason: 'Managed theme token edit',
      },
    });
    project.currentRevision = result.revision;
    managedTheme = {
      ...managedTheme,
      content: next,
      sha256: result.postimageSha256[managedTheme.path],
      revision: result.revision,
    };
    if (activeFile?.path === managedTheme.path) {
      activeFile = { ...managedTheme };
      suppressEditorChange = true;
      editor.setValue(next);
      suppressEditorChange = false;
      elements['editor-state'].textContent = 'Clean';
    }
    elements['theme-status'].textContent = 'Theme updated. Build preview to promote it.';
    renderProjectState();
  } catch (error) {
    elements['theme-status'].textContent =
      error instanceof Error ? error.message : 'Theme update failed.';
  } finally {
    setBusy(false);
  }
}

function hexChannels(value) {
  const match = /^#([0-9a-f]{6})$/i.exec(value);
  if (!match) throw new Error('Theme accent must be an RGB color.');
  return [
    Number.parseInt(match[1].slice(0, 2), 16),
    Number.parseInt(match[1].slice(2, 4), 16),
    Number.parseInt(match[1].slice(4, 6), 16),
  ];
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

function createMinimalUnifiedDiff(before, after, path = activeFile?.path ?? 'unknown') {
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
  return `--- a/${path}\n+++ b/${path}\n@@ -${contextStart + 1},${oldCount} +${contextStart + 1},${newCount} @@\n${body.join('\n')}\n`;
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
