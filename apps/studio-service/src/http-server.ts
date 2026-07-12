import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { chromium } from 'playwright';
import { WebSocket, WebSocketServer } from 'ws';
import { BuildCoordinator } from './build-coordinator.ts';
import { ComparisonService, type ComparisonTransform } from './comparison-service.ts';
import { PreviewCoordinator } from './preview-coordinator.ts';
import type { ProjectService } from './project-service.ts';
import { asServiceError, ServiceError } from './service-error.ts';
import type { BuildRecord, SourcePatch } from './types.ts';

const maximumJsonBytes = 1024 * 1024;

export interface StudioHttpServerOptions {
  readonly studioPort?: number;
  readonly previewPort?: number;
}

/** Owns the authenticated HTTP/WebSocket boundary and dedicated preview artifact origin. */
export class StudioHttpServer {
  readonly #token = randomBytes(32).toString('base64url');
  readonly #studioServer = createServer(
    (request, response) => void this.#routeStudio(request, response),
  );
  readonly #previewServer = createServer(
    (request, response) => void this.#routePreview(request, response),
  );
  readonly #webSockets = new WebSocketServer({ noServer: true });
  readonly #idempotency = new Map<string, { bodySha256: string; response: unknown }>();
  readonly #builds: BuildCoordinator;
  readonly #previews: PreviewCoordinator;
  readonly #comparisons: ComparisonService;
  readonly #studioPort: number;
  readonly #previewPort: number;
  readonly #studioOrigin: string;
  readonly #previewOrigin: string;
  #eventSequence = 0;

  public constructor(
    private readonly repositoryRoot: string,
    private readonly project: ProjectService,
    options: StudioHttpServerOptions = {},
  ) {
    this.#studioPort = options.studioPort ?? 4173;
    this.#previewPort = options.previewPort ?? 4174;
    this.#studioOrigin = `http://127.0.0.1:${String(this.#studioPort)}`;
    this.#previewOrigin = `http://127.0.0.1:${String(this.#previewPort)}`;
    this.#builds = new BuildCoordinator(
      repositoryRoot,
      project,
      async (_artifactDirectory, buildId) => this.#smokePreview(buildId),
      (record) => this.#emit('build.changed', { build: publicBuild(record, this.#previewOrigin) }),
      this.#studioOrigin,
      this.#previewOrigin,
    );
    this.#previews = new PreviewCoordinator(
      project,
      this.#builds,
      this.#previewOrigin,
      this.#studioOrigin,
      this.#token,
    );
    this.#comparisons = new ComparisonService(project, this.#previews);
    this.#studioServer.on('upgrade', (request, socket, head) => {
      const upgradeUrl = new URL(request.url ?? '/', this.#studioOrigin);
      if (
        upgradeUrl.pathname !== '/api/v1/events' ||
        !this.#validHost(request, this.#studioPort) ||
        !this.#authorized(request) ||
        !this.#validOrigin(request)
      ) {
        socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }
      this.#webSockets.handleUpgrade(request, socket, head, (webSocket) => {
        this.#webSockets.emit('connection', webSocket, request);
      });
    });
  }

  /** Starts both loopback listeners and returns the token for the trusted launcher channel. */
  public async listen(): Promise<{ token: string; studioUrl: string }> {
    await this.#builds.initialize();
    await Promise.all([
      listen(this.#studioServer, this.#studioPort),
      listen(this.#previewServer, this.#previewPort),
    ]);
    return { token: this.#token, studioUrl: this.#studioOrigin };
  }

  /** Stops accepting work, closes sockets, and waits for both listener lifecycles. */
  public async close(): Promise<void> {
    for (const client of this.#webSockets.clients) client.close(1001, 'Service shutdown');
    await this.#previews.close();
    await Promise.all([close(this.#studioServer), close(this.#previewServer)]);
  }

  async #routeStudio(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const requestId = request.headers['x-request-id']?.toString() ?? `req_${randomUUID()}`;
    try {
      if (!this.#validHost(request, this.#studioPort)) {
        throw new ServiceError('UNAUTHORIZED', 'The request host is not allowed.', 401, false);
      }
      const url = new URL(request.url ?? '/', this.#studioOrigin);
      if (url.pathname.startsWith('/api/v1/')) {
        setApiHeaders(response, requestId);
        await this.#routeApi(request, response, url);
        return;
      }
      await this.#serveStudioStatic(request, response, url.pathname);
    } catch (error) {
      this.#writeError(response, asServiceError(error), requestId);
    }
  }

  async #routeApi(request: IncomingMessage, response: ServerResponse, url: URL): Promise<void> {
    const method = request.method ?? 'GET';
    if (method !== 'GET' && !this.#validOrigin(request)) {
      throw new ServiceError('UNAUTHORIZED', 'The request origin is not allowed.', 401, false);
    }
    if (url.pathname === '/api/v1/projects' && method === 'GET') {
      const snapshot = await this.project.getSnapshot();
      this.#json(response, 200, {
        projects: [
          {
            projectId: snapshot.projectId,
            name: snapshot.name,
            projectKey: snapshot.projectKey,
            currentRevision: snapshot.currentRevision,
            valid: true,
            validationSummary: [],
          },
        ],
      });
      return;
    }
    const projectPrefix = `/api/v1/projects/${this.project.projectId}`;
    if (url.pathname === projectPrefix && method === 'GET') {
      this.#json(response, 200, await this.project.getSnapshot());
      return;
    }
    if (url.pathname === `${projectPrefix}/files:read` && method === 'POST') {
      const body = await readJsonBody(request);
      const values = requireObject(body);
      assertAllowedKeys(values, ['paths', 'expectedRevision', 'includeContent', 'maxBytesPerFile']);
      const paths = values.paths;
      if (!Array.isArray(paths)) throw invalidRequest('paths must be an array.');
      const maximum =
        values.maxBytesPerFile === undefined ? 262_144 : requireInteger(values.maxBytesPerFile);
      const files = await this.project.readFiles(paths, values.expectedRevision, maximum);
      this.#json(response, 200, { files });
      return;
    }
    if (url.pathname === `${projectPrefix}/files:patch` && method === 'POST') {
      this.#requireMutation(request);
      const body = await readJsonBody(request);
      const result = await this.#idempotent(request, body, async () => {
        const values = requireObject(body);
        assertAllowedKeys(values, ['expectedRevision', 'patches', 'reason']);
        if (!Array.isArray(values.patches)) throw invalidRequest('patches must be an array.');
        const patchResult = await this.project.applyPatches(
          values.expectedRevision,
          parseSourcePatches(values.patches),
        );
        this.#emit('project.revisionChanged', {
          projectId: this.project.projectId,
          revision: patchResult.revision,
          changedPaths: patchResult.changedPaths,
        });
        return patchResult;
      });
      this.#json(response, 200, result);
      return;
    }
    if (url.pathname === `${projectPrefix}/builds` && method === 'POST') {
      this.#requireMutation(request);
      const body = await readJsonBody(request);
      const result = await this.#idempotent(request, body, async () => {
        const values = requireObject(body);
        assertAllowedKeys(values, ['expectedRevision', 'configuration', 'supersedeQueued']);
        if (values.configuration !== 'preview-debug') {
          throw invalidRequest('Phase 2 supports only preview-debug builds.');
        }
        return {
          build: publicBuild(
            await this.#builds.start(values.expectedRevision),
            this.#previewOrigin,
          ),
        };
      });
      this.#json(response, 202, result);
      return;
    }
    if (url.pathname === `${projectPrefix}/previews` && method === 'POST') {
      this.#requireMutation(request);
      const body = await readJsonBody(request);
      const result = await this.#idempotent(request, body, async () => {
        const values = requireObject(body);
        assertAllowedKeys(values, ['buildId', 'mode', 'strictCurrentRevision', 'viewport']);
        if (typeof values.buildId !== 'string' || values.mode !== 'deterministic') {
          throw invalidRequest('A buildId and deterministic mode are required.');
        }
        const frame = await this.#previews.load(
          values.buildId,
          values.strictCurrentRevision === true,
        );
        this.#emit('preview.changed', { identity: frame.identity });
        return { frame };
      });
      this.#json(response, 201, result);
      return;
    }
    if (url.pathname === `${projectPrefix}/references:import` && method === 'POST') {
      this.#requireMutation(request);
      const body = await readJsonBody(request);
      const result = await this.#idempotent(request, body, async () => {
        const values = requireObject(body);
        assertAllowedKeys(values, [
          'expectedRevision',
          'referenceId',
          'mediaType',
          'contentBase64',
        ]);
        const snapshot = await this.project.getSnapshot();
        if (values.expectedRevision !== snapshot.currentRevision) {
          throw new ServiceError(
            'REVISION_CONFLICT',
            'The reference import revision is stale.',
            409,
            true,
          );
        }
        if (typeof values.referenceId !== 'string' || typeof values.contentBase64 !== 'string') {
          throw invalidRequest('referenceId and contentBase64 are required.');
        }
        const bytes = decodeBase64(values.contentBase64);
        return {
          reference: await this.#comparisons.importReference(
            values.referenceId,
            values.mediaType,
            bytes,
          ),
          projectRevision: snapshot.currentRevision,
        };
      });
      this.#json(response, 201, result);
      return;
    }
    if (url.pathname === `${projectPrefix}/comparisons` && method === 'POST') {
      this.#requireMutation(request);
      const body = await readJsonBody(request);
      const result = await this.#idempotent(request, body, async () => {
        const values = requireObject(body);
        assertAllowedKeys(values, ['captureArtifactId', 'referenceId', 'mode', 'transform']);
        if (
          typeof values.captureArtifactId !== 'string' ||
          typeof values.referenceId !== 'string' ||
          !['sideBySide', 'alphaOverlay', 'absoluteDifference', 'edgeDifference'].includes(
            String(values.mode),
          )
        ) {
          throw invalidRequest('Comparison identity or mode is invalid.');
        }
        return {
          comparison: await this.#comparisons.compare(
            values.captureArtifactId,
            values.referenceId,
            values.mode as 'sideBySide' | 'alphaOverlay' | 'absoluteDifference' | 'edgeDifference',
            parseComparisonTransform(values.transform),
          ),
        };
      });
      this.#emit('comparison.changed', result);
      this.#json(response, 201, result);
      return;
    }
    const resetPreview = /^\/api\/v1\/previews\/([^/:]+):reset$/.exec(url.pathname);
    if (resetPreview && method === 'POST') {
      this.#requireMutation(request);
      const previewInstanceId = resetPreview[1];
      if (previewInstanceId === undefined) throw invalidRequest('Preview ID is required.');
      const body = requireObject(await readJsonBody(request));
      assertAllowedKeys(body, ['expected', 'resetKind', 'timeUs']);
      if (body.resetKind !== 'clean' || body.timeUs !== 0) {
        throw invalidRequest('Only clean reset at timeUs 0 is supported.');
      }
      this.#json(response, 200, {
        frame: await this.#previews.reset(
          previewInstanceId,
          validateExpectedIdentity(body.expected, false),
        ),
      });
      return;
    }
    const renderPreview = /^\/api\/v1\/previews\/([^/:]+)\/frames$/.exec(url.pathname);
    if (renderPreview && method === 'POST') {
      this.#requireMutation(request);
      const previewInstanceId = renderPreview[1];
      if (previewInstanceId === undefined) throw invalidRequest('Preview ID is required.');
      const body = requireObject(await readJsonBody(request));
      assertAllowedKeys(body, [
        'expected',
        'timeUs',
        'capturePixels',
        'includeInspection',
        'overlay',
      ]);
      this.#json(response, 200, {
        frame: await this.#previews.render(
          previewInstanceId,
          validateExpectedIdentity(body.expected, false),
          requireNonNegativeInteger(body.timeUs, 'timeUs'),
          body.capturePixels === true,
        ),
      });
      return;
    }
    const actPreview = /^\/api\/v1\/previews\/([^/:]+)\/actions$/.exec(url.pathname);
    if (actPreview && method === 'POST') {
      this.#requireMutation(request);
      const previewInstanceId = actPreview[1];
      if (previewInstanceId === undefined) throw invalidRequest('Preview ID is required.');
      const body = requireObject(await readJsonBody(request));
      assertAllowedKeys(body, [
        'expected',
        'atUs',
        'sequence',
        'action',
        'target',
        'button',
        'renderAfter',
        'capturePixels',
      ]);
      const target = requireObject(body.target);
      assertAllowedKeys(target, ['widgetId']);
      if (
        body.action !== 'click' ||
        target.widgetId !== 'settings.enable' ||
        body.button !== 'left' ||
        body.renderAfter !== true
      ) {
        throw invalidRequest(
          'The Phase 4 vertical slice supports a left click on settings.enable.',
        );
      }
      this.#json(response, 200, {
        frame: await this.#previews.click(
          previewInstanceId,
          validateExpectedIdentity(body.expected, true),
          requireNonNegativeInteger(body.atUs, 'atUs'),
          body.capturePixels === true,
        ),
      });
      return;
    }
    const inspectPreview = /^\/api\/v1\/previews\/([^/:]+)\/inspection:query$/.exec(url.pathname);
    if (inspectPreview && method === 'POST') {
      const previewInstanceId = inspectPreview[1];
      if (previewInstanceId === undefined) throw invalidRequest('Preview ID is required.');
      const body = requireObject(await readJsonBody(request));
      assertAllowedKeys(body, ['expected', 'filter']);
      const filter = requireObject(body.filter);
      assertAllowedKeys(filter, [
        'widgetIds',
        'idPrefix',
        'types',
        'includeValues',
        'includeAnimations',
        'includeDiagnostics',
        'maxDepth',
        'allowMissing',
      ]);
      this.#json(response, 200, {
        frame: this.#previews.inspect(
          previewInstanceId,
          validateExpectedIdentity(body.expected, true),
        ),
      });
      return;
    }
    const capturePreview = /^\/api\/v1\/previews\/([^/:]+)\/captures$/.exec(url.pathname);
    if (capturePreview && method === 'POST') {
      this.#requireMutation(request);
      const previewInstanceId = capturePreview[1];
      if (previewInstanceId === undefined) throw invalidRequest('Preview ID is required.');
      const body = requireObject(await readJsonBody(request));
      assertAllowedKeys(body, [
        'expected',
        'scenario',
        'includeFrames',
        'includeInspection',
        'includeNormalizedTrace',
      ]);
      const selector = requireObject(body.scenario);
      assertAllowedKeys(selector, ['path', 'document']);
      let scenarioDocument = selector.document;
      if (typeof selector.path === 'string') {
        if (scenarioDocument !== undefined)
          throw invalidRequest('Specify scenario path or document, not both.');
        const files = await this.project.readFiles([selector.path], undefined, 262_144);
        const file = files[0];
        if (file === undefined || !('content' in file) || typeof file.content !== 'string') {
          throw invalidRequest('Scenario file is not UTF-8 text.');
        }
        try {
          scenarioDocument = JSON.parse(file.content) as unknown;
        } catch {
          throw new ServiceError('SCENARIO_INVALID', 'Scenario JSON is malformed.', 400, false);
        }
      }
      this.#json(response, 200, {
        capture: await this.#previews.capture(
          previewInstanceId,
          validateExpectedIdentity(body.expected, false),
          parseCaptureScenario(scenarioDocument),
        ),
      });
      return;
    }
    const artifactMatch = /^\/api\/v1\/artifacts\/([^/:]+)$/.exec(url.pathname);
    if (artifactMatch && method === 'GET') {
      if (!this.#authorized(request)) {
        throw new ServiceError('UNAUTHORIZED', 'Artifact authentication is required.', 401, false);
      }
      const artifactId = artifactMatch[1];
      if (artifactId === undefined) throw invalidRequest('Artifact ID is required.');
      const bytes = await this.#previews.readArtifact(artifactId);
      response.writeHead(200, {
        'Cache-Control': 'no-store',
        'Content-Type': 'image/png',
        'X-Content-Type-Options': 'nosniff',
      });
      response.end(bytes);
      return;
    }
    const buildMatch = new RegExp(
      `^${escapeRegularExpression(projectPrefix)}/builds/([^/:]+)$`,
    ).exec(url.pathname);
    if (buildMatch && method === 'GET') {
      const buildId = buildMatch[1];
      if (buildId === undefined) throw invalidRequest('The build ID is missing.');
      this.#json(response, 200, {
        build: publicBuild(this.#builds.get(buildId), this.#previewOrigin),
      });
      return;
    }
    const cancelMatch = new RegExp(
      `^${escapeRegularExpression(projectPrefix)}/builds/([^/:]+):cancel$`,
    ).exec(url.pathname);
    if (cancelMatch && method === 'POST') {
      const buildId = cancelMatch[1];
      if (buildId === undefined) throw invalidRequest('The build ID is missing.');
      this.#requireMutation(request);
      this.#json(response, 200, {
        build: publicBuild(await this.#builds.cancel(buildId), this.#previewOrigin),
      });
      return;
    }
    const logMatch = new RegExp(
      `^${escapeRegularExpression(projectPrefix)}/builds/([^/:]+)/log$`,
    ).exec(url.pathname);
    if (logMatch && method === 'GET') {
      if (!this.#authorized(request)) {
        throw new ServiceError('UNAUTHORIZED', 'A valid bearer token is required.', 401, false);
      }
      const buildId = logMatch[1];
      if (buildId === undefined) throw invalidRequest('The build ID is missing.');
      this.#json(response, 200, { buildId, rawLog: this.#builds.get(buildId).rawLog });
      return;
    }
    throw new ServiceError('FILE_NOT_FOUND', 'The API route does not exist.', 404, false);
  }

  async #routePreview(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const requestId = `req_${randomUUID()}`;
    try {
      if (!this.#validHost(request, this.#previewPort)) {
        throw new ServiceError('UNAUTHORIZED', 'The preview host is not allowed.', 401, false);
      }
      const url = new URL(request.url ?? '/', this.#previewOrigin);
      if (url.pathname === '/api/authorize' && request.method === 'OPTIONS') {
        if (!this.#validOrigin(request)) {
          throw new ServiceError(
            'UNAUTHORIZED',
            'Preview authorization origin failed.',
            401,
            false,
          );
        }
        response.writeHead(204, {
          'Access-Control-Allow-Credentials': 'true',
          'Access-Control-Allow-Headers': 'Authorization',
          'Access-Control-Allow-Methods': 'POST',
          'Access-Control-Allow-Origin': this.#studioOrigin,
          Vary: 'Origin',
        });
        response.end();
        return;
      }
      if (url.pathname === '/api/authorize' && request.method === 'POST') {
        if (!this.#validOrigin(request) || !this.#authorized(request)) {
          throw new ServiceError('UNAUTHORIZED', 'Preview authorization failed.', 401, false);
        }
        response.writeHead(204, {
          'Access-Control-Allow-Credentials': 'true',
          'Access-Control-Allow-Origin': this.#studioOrigin,
          'Set-Cookie': `studio_session=${this.#token}; HttpOnly; SameSite=Strict; Path=/`,
          Vary: 'Origin',
        });
        response.end();
        return;
      }
      if (!this.#previewCookieAuthorized(request)) {
        throw new ServiceError(
          'UNAUTHORIZED',
          'Preview artifact authorization is required.',
          401,
          false,
        );
      }
      const match = /^\/builds\/([^/]+)\/(preview\.(?:html|js|wasm))$/.exec(url.pathname);
      if (!match || request.method !== 'GET') {
        throw new ServiceError(
          'FILE_NOT_FOUND',
          'The preview artifact does not exist.',
          404,
          false,
        );
      }
      const buildId = match[1];
      const name = match[2];
      if (buildId === undefined || name === undefined) {
        throw new ServiceError(
          'FILE_NOT_FOUND',
          'The preview artifact does not exist.',
          404,
          false,
        );
      }
      const path = this.#builds.artifactPath(buildId, name);
      const bytes = await readFile(path);
      response.writeHead(200, previewHeaders(path));
      response.end(bytes);
    } catch (error) {
      this.#writeError(response, asServiceError(error), requestId);
    }
  }

  async #serveStudioStatic(
    request: IncomingMessage,
    response: ServerResponse,
    pathname: string,
  ): Promise<void> {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405).end();
      return;
    }
    const studioRoot = resolve(this.repositoryRoot, 'apps/studio-web');
    const vendorRoot = resolve(this.repositoryRoot, 'node_modules/monaco-editor/min');
    const relativePath = pathname === '/' ? 'index.html' : pathname.slice(1);
    const selectedRoot = relativePath.startsWith('vendor/monaco/') ? vendorRoot : studioRoot;
    const selectedRelative = relativePath.startsWith('vendor/monaco/')
      ? relativePath.slice('vendor/monaco/'.length)
      : relativePath;
    const path = confinedStaticPath(selectedRoot, selectedRelative);
    let bytes = await readFile(path);
    const nonce = randomBytes(16).toString('base64url');
    if (relativePath === 'index.html') {
      bytes = Buffer.from(
        bytes
          .toString('utf8')
          .replaceAll('__STUDIO_SESSION_TOKEN__', this.#token)
          .replaceAll('__STUDIO_CSP_NONCE__', nonce),
      );
    }
    response.writeHead(200, {
      'Cache-Control': 'no-store',
      'Content-Security-Policy': `default-src 'self'; script-src 'self' 'nonce-${nonce}' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; frame-src ${this.#previewOrigin}; connect-src 'self' ${this.#previewOrigin} ws://127.0.0.1:${String(this.#studioPort)}; img-src 'self' data: blob:; font-src 'self' data:; worker-src 'self' blob:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
      'Content-Type': mediaType(path),
      'Cross-Origin-Resource-Policy': 'same-origin',
      'X-Content-Type-Options': 'nosniff',
    });
    response.end(request.method === 'HEAD' ? undefined : bytes);
  }

  async #smokePreview(buildId: string): Promise<boolean> {
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext();
      await context.addCookies([
        {
          name: 'studio_session',
          value: this.#token,
          url: this.#previewOrigin,
          httpOnly: true,
          sameSite: 'Strict',
        },
      ]);
      const page = await context.newPage();
      await page.goto(
        `${this.#previewOrigin}/builds/${buildId}/preview.html?parentOrigin=${encodeURIComponent(this.#studioOrigin)}`,
      );
      await page.waitForFunction(
        () =>
          (globalThis as typeof globalThis & { __studioLastFrame?: { renderer?: string } })
            .__studioLastFrame?.renderer === 'webgl2',
        null,
        { timeout: 10_000 },
      );
      return true;
    } catch {
      return false;
    } finally {
      await browser.close();
    }
  }

  #requireMutation(request: IncomingMessage): void {
    if (!this.#authorized(request)) {
      throw new ServiceError('UNAUTHORIZED', 'A valid bearer token is required.', 401, false);
    }
    const key = request.headers['idempotency-key'];
    if (
      typeof key !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key)
    ) {
      throw invalidRequest('A UUID v4 Idempotency-Key is required.');
    }
  }

  #authorized(request: IncomingMessage): boolean {
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith('Bearer ')) return false;
    return constantTimeEqual(authorization.slice('Bearer '.length), this.#token);
  }

  #previewCookieAuthorized(request: IncomingMessage): boolean {
    const cookie = request.headers.cookie
      ?.split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith('studio_session='));
    return (
      cookie !== undefined && constantTimeEqual(cookie.slice('studio_session='.length), this.#token)
    );
  }

  #validOrigin(request: IncomingMessage): boolean {
    const origin = request.headers.origin;
    return origin === undefined
      ? request.headers['x-studio-client'] === 'agent-v1'
      : origin === this.#studioOrigin;
  }

  #validHost(request: IncomingMessage, port: number): boolean {
    const portText = String(port);
    return (
      request.headers.host === `127.0.0.1:${portText}` ||
      request.headers.host === `localhost:${portText}`
    );
  }

  async #idempotent<T>(
    request: IncomingMessage,
    body: unknown,
    operation: () => Promise<T>,
  ): Promise<T> {
    const key = request.headers['idempotency-key'] as string;
    const bodySha256 = createHash('sha256').update(JSON.stringify(body)).digest('hex');
    const prior = this.#idempotency.get(key);
    if (prior) {
      if (prior.bodySha256 !== bodySha256) {
        throw invalidRequest('The idempotency key was reused with a different request body.');
      }
      return prior.response as T;
    }
    const result = await operation();
    this.#idempotency.set(key, { bodySha256, response: structuredClone(result) });
    return result;
  }

  #emit(type: string, payload: unknown): void {
    const event = JSON.stringify({ sequence: ++this.#eventSequence, type, payload });
    for (const client of this.#webSockets.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(event);
    }
  }

  #json(response: ServerResponse, status: number, body: unknown): void {
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(`${JSON.stringify(body)}\n`);
  }

  #writeError(response: ServerResponse, error: ServiceError, requestId: string): void {
    if (response.headersSent) {
      response.end();
      return;
    }
    setApiHeaders(response, requestId);
    this.#json(response, error.statusCode, {
      error: {
        code: error.code,
        message: error.message,
        retryable: error.retryable,
        requestId,
        details: error.details,
      },
    });
  }
}

interface PublicBuildRecord {
  readonly schemaVersion: 1;
  readonly buildId: string;
  readonly projectId: string;
  readonly projectRevision: string;
  readonly configuration: 'preview-debug';
  readonly status: BuildRecord['status'];
  readonly toolchainVersionSet: string;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly smokePassed: boolean | null;
  readonly diagnostics: BuildRecord['diagnostics'];
  readonly artifacts: {
    artifactId: string;
    kind: 'wasm' | 'loader';
    sha256: string;
    sizeBytes: number;
  }[];
  readonly phaseDurationsMs: Readonly<Record<string, number>>;
  readonly cache: BuildRecord['cache'];
  readonly previewArtifacts: Record<string, string>;
}

function publicBuild(record: BuildRecord, previewOrigin: string): PublicBuildRecord {
  const artifacts = Object.entries(record.artifactSha256).flatMap(([name, digest]) => {
    const sizeBytes = record.artifactSizeBytes[name];
    if (sizeBytes === undefined || name === 'preview.html') return [];
    return [
      {
        artifactId: `art_${record.buildId}_${name.replace('.', '_')}`,
        kind: name.endsWith('.wasm') ? ('wasm' as const) : ('loader' as const),
        sha256: digest,
        sizeBytes,
      },
    ];
  });
  return {
    schemaVersion: record.schemaVersion,
    buildId: record.buildId,
    projectId: record.projectId,
    projectRevision: record.projectRevision,
    configuration: record.configuration,
    status: record.status,
    toolchainVersionSet: record.toolchainVersionSet,
    startedAt: record.startedAt,
    completedAt: record.completedAt,
    smokePassed: record.smokePassed,
    diagnostics: record.diagnostics,
    artifacts,
    phaseDurationsMs: record.phaseDurationsMs,
    cache: record.cache,
    previewArtifacts:
      record.status === 'succeeded'
        ? Object.fromEntries(
            Object.keys(record.artifactSha256).map((name) => [
              name,
              `${previewOrigin}/builds/${record.buildId}/${name}`,
            ]),
          )
        : {},
  };
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > maximumJsonBytes)
      throw new ServiceError('LIMIT_EXCEEDED', 'The request body is too large.', 413, false);
    chunks.push(new Uint8Array(bytes));
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
  } catch {
    throw invalidRequest('The request body must be valid UTF-8 JSON.');
  }
}

function requireObject(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw invalidRequest('The request body must be a JSON object.');
  }
  return value as Record<string, unknown>;
}

function requireInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0)
    throw invalidRequest('The byte limit must be a positive integer.');
  return value as number;
}

function requireNonNegativeInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw invalidRequest(`${field} must be a non-negative safe integer.`);
  }
  return value as number;
}

function decodeBase64(value: string): Buffer {
  if (value.length === 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    throw invalidRequest('contentBase64 is malformed.');
  }
  return Buffer.from(value, 'base64');
}

function parseComparisonTransform(value: unknown): ComparisonTransform {
  const transform = requireObject(value);
  assertAllowedKeys(transform, [
    'translateMicroPx',
    'scaleMillionths',
    'cropPx',
    'opacityMillionths',
  ]);
  return {
    translateMicroPx: transform.translateMicroPx as readonly [number, number],
    scaleMillionths: transform.scaleMillionths as number,
    cropPx: transform.cropPx as readonly [number, number, number, number] | null,
    opacityMillionths: transform.opacityMillionths as number,
  };
}

function parseCaptureScenario(value: unknown): {
  id: string;
  steps: { sequence: number; atUs: number; action: string; target?: { widgetId?: string } }[];
  capture: { startUs: number; endUs: number; fps: number };
} {
  const scenario = requireObject(value);
  const capture = requireObject(scenario.capture);
  if (typeof scenario.id !== 'string' || !Array.isArray(scenario.steps)) {
    throw new ServiceError('SCENARIO_INVALID', 'Scenario id and steps are required.', 400, false);
  }
  const steps = scenario.steps.map((entry) => {
    const step = requireObject(entry);
    const target = step.target === undefined ? undefined : requireObject(step.target);
    if (
      !Number.isSafeInteger(step.sequence) ||
      !Number.isSafeInteger(step.atUs) ||
      typeof step.action !== 'string'
    ) {
      throw new ServiceError('SCENARIO_INVALID', 'Scenario step is malformed.', 400, false);
    }
    return {
      sequence: step.sequence as number,
      atUs: step.atUs as number,
      action: step.action,
      ...(target === undefined
        ? {}
        : {
            target: {
              ...(typeof target.widgetId === 'string' ? { widgetId: target.widgetId } : {}),
            },
          }),
    };
  });
  return {
    id: scenario.id,
    steps,
    capture: {
      startUs: capture.startUs as number,
      endUs: capture.endUs as number,
      fps: capture.fps as number,
    },
  };
}

function validateExpectedIdentity(value: unknown, requireFrame: boolean): Record<string, unknown> {
  const expected = requireObject(value);
  assertAllowedKeys(
    expected,
    requireFrame ? ['buildId', 'projectRevision', 'frameId'] : ['buildId', 'projectRevision'],
  );
  if (
    typeof expected.buildId !== 'string' ||
    typeof expected.projectRevision !== 'string' ||
    (requireFrame && typeof expected.frameId !== 'string')
  ) {
    throw invalidRequest('Expected build, revision, and frame identity is malformed.');
  }
  return expected;
}

function parseSourcePatches(values: readonly unknown[]): SourcePatch[] {
  return values.map((value) => {
    const patch = requireObject(value);
    assertAllowedKeys(patch, ['path', 'expectedSha256', 'unifiedDiff', 'delete']);
    if (typeof patch.path !== 'string' || typeof patch.unifiedDiff !== 'string') {
      throw invalidRequest('Each patch requires string path and unifiedDiff fields.');
    }
    if (
      patch.expectedSha256 !== null &&
      (typeof patch.expectedSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(patch.expectedSha256))
    ) {
      throw invalidRequest('Each patch requires a SHA-256 preimage or null for creation.');
    }
    if (patch.delete !== undefined && typeof patch.delete !== 'boolean') {
      throw invalidRequest('Patch delete must be boolean when supplied.');
    }
    return {
      path: patch.path,
      expectedSha256: patch.expectedSha256,
      unifiedDiff: patch.unifiedDiff,
      ...(patch.delete === undefined ? {} : { delete: patch.delete }),
    };
  });
}

function assertAllowedKeys(value: Record<string, unknown>, allowed: readonly string[]): void {
  const unexpected = Object.keys(value).filter((key) => !allowed.includes(key));
  const field = unexpected[0];
  if (field !== undefined) {
    throw invalidRequest(`Unknown request field '${field}'.`);
  }
}

function invalidRequest(message: string): ServiceError {
  return new ServiceError('INVALID_REQUEST', message, 400, false);
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function setApiHeaders(response: ServerResponse, requestId: string): void {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Request-Id', requestId);
}

function previewHeaders(path: string): Record<string, string> {
  return {
    'Cache-Control': 'no-store',
    'Content-Security-Policy':
      "default-src 'none'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data: blob:; font-src 'self'; base-uri 'none'; form-action 'none'",
    'Content-Type': mediaType(path),
    'Cross-Origin-Resource-Policy': 'same-origin',
    'X-Content-Type-Options': 'nosniff',
  };
}

function mediaType(path: string): string {
  switch (extname(path)) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.js':
      return 'text/javascript; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.wasm':
      return 'application/wasm';
    case '.json':
      return 'application/json; charset=utf-8';
    default:
      return 'application/octet-stream';
  }
}

function confinedStaticPath(root: string, relativePath: string): string {
  const path = resolve(root, relativePath);
  const prefix = root.endsWith(sep) ? root : `${root}${sep}`;
  if (!path.startsWith(prefix))
    throw new ServiceError('FILE_NOT_FOUND', 'Static file not found.', 404, false);
  return path;
}

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function listen(server: ReturnType<typeof createServer>, port: number): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolvePromise());
  });
}

function close(server: ReturnType<typeof createServer>): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    server.close((error) => (error ? reject(error) : resolvePromise()));
  });
}
