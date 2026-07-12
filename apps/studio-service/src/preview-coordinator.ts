/**
 * Owns isolated Chromium preview instances and their immutable frame history. The coordinator is
 * the sole service authority for deterministic time, exact-frame targeting, and pixel artifacts;
 * HTTP routing validates transport shape but never reaches into browser pages directly.
 */
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import type { BuildCoordinator } from './build-coordinator.ts';
import type { ProjectService } from './project-service.ts';
import { ServiceError } from './service-error.ts';
import type { ImageArtifact, StoredFrame } from './types.ts';

const maximumStoredFrames = 500;

interface PreviewRuntimeFrame {
  readonly clock: { readonly timeUs: number; readonly frameIndex: number };
  readonly toggle: {
    readonly widgetId: 'settings.enable';
    readonly xPx: number;
    readonly yPx: number;
    readonly widthPx: number;
    readonly heightPx: number;
    readonly enabled: boolean;
    readonly progress: number;
    readonly settled: boolean;
  };
}

interface PreviewInstance {
  readonly previewInstanceId: string;
  readonly buildId: string;
  readonly projectRevision: string;
  readonly context: BrowserContext;
  readonly page: Page;
  readonly frames: Map<string, StoredFrame>;
  lastFrame: StoredFrame;
  busy: boolean;
}

/** Coordinates deterministic preview instances for one project and launch token. */
export class PreviewCoordinator {
  readonly #instances = new Map<string, PreviewInstance>();
  readonly #artifacts = new Map<string, string>();
  #browser: Browser | null = null;

  public constructor(
    private readonly project: ProjectService,
    private readonly builds: BuildCoordinator,
    private readonly previewOrigin: string,
    private readonly studioOrigin: string,
    private readonly token: string,
  ) {}

  /** Closes every page/context and the owned Chromium process during service shutdown. */
  public async close(): Promise<void> {
    const instances = [...this.#instances.values()];
    this.#instances.clear();
    await Promise.allSettled(instances.map(async (instance) => instance.context.close()));
    await this.#browser?.close();
    this.#browser = null;
  }

  /** Loads one successful immutable build into a new deterministic browser context. */
  public async load(buildId: string, strictCurrentRevision: boolean): Promise<StoredFrame> {
    const build = this.builds.get(buildId);
    if (build.status !== 'succeeded' || build.smokePassed !== true) {
      throw new ServiceError('BUILD_FAILED', 'Only a smoke-passed build can load.', 409, false);
    }
    const snapshot = await this.project.getSnapshot();
    if (strictCurrentRevision && snapshot.currentRevision !== build.projectRevision) {
      throw new ServiceError(
        'PREVIEW_REVISION_MISMATCH',
        'The successful build is older than the current project revision.',
        409,
        false,
      );
    }
    this.#browser ??= await chromium.launch({ headless: true });
    const context = await this.#browser.newContext({ viewport: { width: 900, height: 600 } });
    await context.addCookies([
      {
        name: 'studio_session',
        value: this.token,
        url: this.previewOrigin,
        httpOnly: true,
        sameSite: 'Strict',
      },
    ]);
    const page = await context.newPage();
    await page.addInitScript(() => {
      globalThis.readRuntimeFrame = (): PreviewRuntimeFrame | null =>
        globalThis.__studioLastFrame ?? null;
    });
    const previewInstanceId = `prv_${randomUUID()}`;
    await page.goto(
      `${this.previewOrigin}/builds/${buildId}/preview.html?parentOrigin=${encodeURIComponent(this.studioOrigin)}&projectId=${encodeURIComponent(this.project.projectId)}&projectRevision=${encodeURIComponent(build.projectRevision)}&buildId=${encodeURIComponent(buildId)}&previewInstanceId=${encodeURIComponent(previewInstanceId)}`,
    );
    await page.waitForFunction(() => readRuntimeFrame() !== null, null, { timeout: 10_000 });
    const runtimeFrame = await this.#readRuntimeFrame(page);
    const initial = await this.#storeFrame(
      { previewInstanceId, buildId, projectRevision: build.projectRevision },
      runtimeFrame,
      0,
      null,
    );
    const instance: PreviewInstance = {
      previewInstanceId,
      buildId,
      projectRevision: build.projectRevision,
      context,
      page,
      frames: new Map([[initial.identity.frameId, initial]]),
      lastFrame: initial,
      busy: false,
    };
    this.#instances.set(previewInstanceId, instance);
    return initial;
  }

  /** Performs a clean reset and stores the resulting canonical time-zero frame. */
  public async reset(previewInstanceId: string, expected: unknown): Promise<StoredFrame> {
    const instance = this.#requireExpected(previewInstanceId, expected);
    return this.#exclusive(instance, async () => {
      await instance.page.evaluate(() => {
        globalThis.__studioResetRequested = true;
        globalThis.__studioDeterministicTimeUs = 0;
      });
      await instance.page.waitForFunction((previousFrameIndex) => {
        const frame = readRuntimeFrame();
        return frame?.clock.timeUs === 0 && frame.clock.frameIndex <= previousFrameIndex;
      }, instance.lastFrame.frameIndex);
      const runtimeFrame = await this.#readRuntimeFrame(instance.page);
      instance.frames.clear();
      return this.#appendFrame(instance, runtimeFrame, 0, null);
    });
  }

  /** Advances deterministic time monotonically and optionally captures the exact canvas pixels. */
  public async render(
    previewInstanceId: string,
    expected: unknown,
    timeUs: number,
    capturePixels: boolean,
  ): Promise<StoredFrame> {
    const instance = this.#requireExpected(previewInstanceId, expected);
    if (!Number.isSafeInteger(timeUs) || timeUs < instance.lastFrame.timeUs) {
      throw new ServiceError(
        'INVALID_REQUEST',
        'timeUs must be a safe non-decreasing integer; reset before backward seek.',
        400,
        false,
      );
    }
    return this.#exclusive(instance, async () => {
      const previousIndex = instance.lastFrame.frameIndex;
      await instance.page.evaluate((requestedTimeUs) => {
        globalThis.__studioDeterministicTimeUs = requestedTimeUs;
      }, timeUs);
      await instance.page.waitForFunction(
        ({ requestedTimeUs, previousIndex }) => {
          const frame = readRuntimeFrame();
          return frame?.clock.timeUs === requestedTimeUs && frame.clock.frameIndex > previousIndex;
        },
        { requestedTimeUs: timeUs, previousIndex },
      );
      const runtimeFrame = await this.#readRuntimeFrame(instance.page);
      const artifact = capturePixels ? await this.#capture(instance) : null;
      return this.#appendFrame(
        instance,
        runtimeFrame,
        timeUs - instance.lastFrame.timeUs,
        artifact,
      );
    });
  }

  /** Clicks a stable widget from the exact named frame and returns the resulting render frame. */
  public async click(
    previewInstanceId: string,
    expected: unknown,
    atUs: number,
    capturePixels: boolean,
  ): Promise<StoredFrame> {
    const instance = this.#requireExpected(previewInstanceId, expected, true);
    const expectedRecord = expected as Record<string, unknown>;
    const source = instance.frames.get(String(expectedRecord.frameId));
    if (!source)
      throw new ServiceError('FRAME_NOT_FOUND', 'The target frame was evicted.', 404, false);
    const target = source.widgets[0];
    if (!target) throw new ServiceError('TARGET_NOT_FOUND', 'The widget is absent.', 404, false);
    if (!target.visible || target.clipped || !target.interaction.interactable) {
      throw new ServiceError(
        'TARGET_NOT_INTERACTABLE',
        'The widget cannot receive input in the named frame.',
        409,
        false,
      );
    }
    if (!Number.isSafeInteger(atUs) || atUs < instance.lastFrame.timeUs) {
      throw new ServiceError('INVALID_REQUEST', 'atUs must be monotonic.', 400, false);
    }
    return this.#exclusive(instance, async () => {
      if (atUs > instance.lastFrame.timeUs) {
        await instance.page.evaluate((timeUs) => {
          globalThis.__studioDeterministicTimeUs = timeUs;
        }, atUs);
        await instance.page.waitForFunction(
          (timeUs) => readRuntimeFrame()?.clock.timeUs === timeUs,
          atUs,
        );
      }
      const [xPx, yPx, widthPx, heightPx] = target.hitboxPx;
      const previousIndex = instance.lastFrame.frameIndex;
      const previousValue = target.values.value;
      await instance.page.locator('#canvas').click({
        position: { x: xPx + widthPx / 2, y: yPx + heightPx / 2 },
      });
      await instance.page.waitForFunction(
        ({ previousIndex, previousValue }) => {
          const frame = readRuntimeFrame();
          return (
            (frame?.clock.frameIndex ?? -1) > previousIndex &&
            frame?.toggle.enabled !== previousValue
          );
        },
        { previousIndex, previousValue },
      );
      const runtimeFrame = await this.#readRuntimeFrame(instance.page);
      const artifact = capturePixels ? await this.#capture(instance) : null;
      return this.#appendFrame(instance, runtimeFrame, atUs - instance.lastFrame.timeUs, artifact);
    });
  }

  /** Returns an immutable stored frame; this operation never advances preview time or input. */
  public inspect(previewInstanceId: string, expected: unknown): StoredFrame {
    const instance = this.#requireExpected(previewInstanceId, expected, true);
    const frameId = String((expected as Record<string, unknown>).frameId);
    const frame = instance.frames.get(frameId);
    if (!frame) throw new ServiceError('FRAME_NOT_FOUND', 'The frame was evicted.', 404, false);
    return structuredClone(frame);
  }

  /**
   * Executes the bounded Phase 4 toggle scenario from a clean reset and returns canonical cadence
   * frames plus normalized trace bytes. Opaque runtime identities are deliberately excluded from
   * the digest so independent clean captures can be compared byte-for-byte.
   */
  public async capture(
    previewInstanceId: string,
    expected: unknown,
    scenario: {
      id: string;
      steps: readonly {
        sequence: number;
        atUs: number;
        action: string;
        target?: { widgetId?: string };
      }[];
      capture: { startUs: number; endUs: number; fps: number };
    },
  ): Promise<{
    captureId: string;
    status: 'succeeded';
    scenarioId: string;
    frames: readonly StoredFrame[];
    normalizedTrace: string;
    normalizedTraceSha256: string;
  }> {
    validateScenario(scenario);
    let current = await this.reset(previewInstanceId, expected);
    const expectedPreview = {
      buildId: current.identity.buildId,
      projectRevision: current.identity.projectRevision,
    };
    const steps = [...scenario.steps].sort((left, right) =>
      left.atUs === right.atUs ? left.sequence - right.sequence : left.atUs - right.atUs,
    );
    const frames: StoredFrame[] = [];
    let stepIndex = 0;
    for (const timeUs of captureTimestamps(scenario.capture)) {
      let step = steps[stepIndex];
      while (step !== undefined && step.atUs <= timeUs) {
        if (step.action !== 'click' || step.target?.widgetId !== 'settings.enable') {
          throw new ServiceError(
            'SCENARIO_INVALID',
            `Unsupported scenario action at step ${String(stepIndex)}.`,
            400,
            false,
          );
        }
        current = await this.click(
          previewInstanceId,
          { ...expectedPreview, frameId: current.identity.frameId },
          step.atUs,
          false,
        );
        stepIndex += 1;
        step = steps[stepIndex];
      }
      current = await this.render(previewInstanceId, expectedPreview, timeUs, true);
      frames.push(current);
    }
    const normalizedTrace = `${JSON.stringify(
      frames.map((frame) => ({
        timeUs: frame.timeUs,
        stateDigest: frame.stateDigest,
        widgets: frame.widgets,
        diagnostics: frame.diagnostics.map((diagnostic) => diagnostic.code),
      })),
    )}\n`;
    return {
      captureId: `cap_${randomUUID()}`,
      status: 'succeeded',
      scenarioId: scenario.id,
      frames,
      normalizedTrace,
      normalizedTraceSha256: createHash('sha256').update(normalizedTrace).digest('hex'),
    };
  }

  /** Resolves an authenticated artifact ID to bytes after ownership was established at creation. */
  public async readArtifact(artifactId: string): Promise<Buffer> {
    const resident = this.#artifacts.get(artifactId);
    const path =
      resident ??
      (/^art_[0-9a-f-]{36}$/i.test(artifactId)
        ? resolve(this.project.root, '.studio', 'artifacts', `${artifactId}.png`)
        : null);
    if (!path) throw new ServiceError('FILE_NOT_FOUND', 'The artifact does not exist.', 404, false);
    try {
      return await readFile(path);
    } catch {
      throw new ServiceError('FILE_NOT_FOUND', 'The artifact does not exist.', 404, false);
    }
  }

  /** Stores derived PNG bytes behind a new opaque authenticated artifact identity. */
  public async storeArtifact(
    bytes: Uint8Array,
    widthPx: number,
    heightPx: number,
  ): Promise<ImageArtifact> {
    const artifactId = `art_${randomUUID()}`;
    const directory = resolve(this.project.root, '.studio', 'artifacts');
    await mkdir(directory, { recursive: true });
    const path = resolve(directory, `${artifactId}.png`);
    await writeFile(path, bytes, { flag: 'wx' });
    this.#artifacts.set(artifactId, path);
    return {
      artifactId,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      mediaType: 'image/png',
      widthPx,
      heightPx,
    };
  }

  #requireExpected(
    previewInstanceId: string,
    expected: unknown,
    requireFrame = false,
  ): PreviewInstance {
    const instance = this.#instances.get(previewInstanceId);
    if (!instance)
      throw new ServiceError('PREVIEW_NOT_READY', 'The preview is unavailable.', 404, true);
    if (expected === null || typeof expected !== 'object' || Array.isArray(expected)) {
      throw new ServiceError('INVALID_REQUEST', 'expected identity is required.', 400, false);
    }
    const value = expected as Record<string, unknown>;
    if (
      value.buildId !== instance.buildId ||
      value.projectRevision !== instance.projectRevision ||
      (requireFrame && typeof value.frameId !== 'string')
    ) {
      throw new ServiceError(
        'PREVIEW_IDENTITY_MISMATCH',
        'The expected preview identity is stale.',
        409,
        true,
      );
    }
    return instance;
  }

  async #exclusive<T>(instance: PreviewInstance, operation: () => Promise<T>): Promise<T> {
    if (instance.busy) {
      throw new ServiceError('PREVIEW_NOT_READY', 'The preview is busy.', 409, true);
    }
    instance.busy = true;
    try {
      return await operation();
    } finally {
      instance.busy = false;
    }
  }

  async #readRuntimeFrame(page: Page): Promise<PreviewRuntimeFrame> {
    const frame = await page.evaluate(() => readRuntimeFrame());
    if (!frame) throw new ServiceError('INSPECTION_FAILED', 'No runtime frame exists.', 500, true);
    return frame;
  }

  async #appendFrame(
    instance: PreviewInstance,
    runtimeFrame: PreviewRuntimeFrame,
    deltaUs: number,
    artifact: ImageArtifact | null,
  ): Promise<StoredFrame> {
    const stored = await this.#storeFrame(instance, runtimeFrame, deltaUs, artifact);
    instance.frames.set(stored.identity.frameId, stored);
    instance.lastFrame = stored;
    while (instance.frames.size > maximumStoredFrames) {
      const oldest = instance.frames.keys().next().value;
      if (oldest === undefined) break;
      instance.frames.delete(oldest);
    }
    return structuredClone(stored);
  }

  async #storeFrame(
    identity: Pick<PreviewInstance, 'previewInstanceId' | 'buildId' | 'projectRevision'>,
    runtimeFrame: PreviewRuntimeFrame,
    deltaUs: number,
    imageArtifact: ImageArtifact | null,
  ): Promise<StoredFrame> {
    const snapshot = await this.project.getSnapshot();
    const toggle = runtimeFrame.toggle;
    const stateDigest = createHash('sha256')
      .update(
        JSON.stringify({
          timeUs: runtimeFrame.clock.timeUs,
          enabled: toggle.enabled,
          progressMillionths: Math.round(toggle.progress * 1_000_000),
          settled: toggle.settled,
        }),
      )
      .digest('hex');
    return {
      schemaVersion: 1,
      identity: {
        projectId: this.project.projectId,
        currentProjectRevision: snapshot.currentRevision,
        projectRevision: identity.projectRevision,
        buildId: identity.buildId,
        previewInstanceId: identity.previewInstanceId,
        frameId: `frm_${randomUUID()}`,
        stale: snapshot.currentRevision !== identity.projectRevision,
      },
      frameIndex: runtimeFrame.clock.frameIndex,
      timeUs: runtimeFrame.clock.timeUs,
      deltaUs,
      stateDigest,
      viewport: { widthPx: 900, heightPx: 600, dpiScaleMilli: 1000 },
      widgets: [
        {
          widgetId: 'settings.enable',
          semanticType: 'animated_toggle',
          boundsPx: [toggle.xPx, toggle.yPx, toggle.widthPx, toggle.heightPx],
          hitboxPx: [toggle.xPx, toggle.yPx, toggle.widthPx, toggle.heightPx],
          visible: true,
          clipped: false,
          interaction: {
            interactable: true,
            disabled: false,
            hovered: false,
            held: false,
            pressedThisFrame: false,
            active: false,
          },
          values: { value: toggle.enabled },
          animations: {
            active: {
              kind: 'float',
              valueMillionths: Math.round(toggle.progress * 1_000_000),
              targetMillionths: toggle.enabled ? 1_000_000 : 0,
              settled: toggle.settled,
            },
          },
        },
      ],
      diagnostics: [],
      imageArtifact,
    };
  }

  async #capture(instance: PreviewInstance): Promise<ImageArtifact> {
    const requestId = `req_${randomUUID()}`;
    await instance.page.evaluate((captureRequestId) => {
      globalThis.__studioLastCaptureBytes = null;
      globalThis.__studioCaptureRequest = { requestId: captureRequestId };
    }, requestId);
    await instance.page.waitForFunction(() => globalThis.__studioLastCaptureBytes !== null);
    const encoded = await instance.page.evaluate(async () => {
      const bytes = globalThis.__studioLastCaptureBytes;
      if (bytes === null || bytes === undefined) throw new Error('Capture bytes are unavailable.');
      return new Promise<string>((resolvePromise, reject) => {
        const reader = new FileReader();
        reader.addEventListener('load', () => {
          if (typeof reader.result !== 'string') {
            reject(new Error('Capture encoding returned a non-string result.'));
            return;
          }
          resolvePromise(reader.result.split(',')[1] ?? '');
        });
        reader.addEventListener('error', () =>
          reject(reader.error ?? new Error('Capture encoding failed.')),
        );
        reader.readAsDataURL(new Blob([bytes], { type: 'image/png' }));
      });
    });
    const bytes = Buffer.from(encoded, 'base64');
    return this.storeArtifact(bytes, 900, 600);
  }
}

function captureTimestamps(capture: { startUs: number; endUs: number; fps: number }): number[] {
  const result: number[] = [];
  for (let index = 0; ; index += 1) {
    const timeUs = capture.startUs + Math.floor((index * 1_000_000) / capture.fps);
    if (timeUs > capture.endUs) break;
    if (result.at(-1) !== timeUs) result.push(timeUs);
  }
  if (result.at(-1) !== capture.endUs) result.push(capture.endUs);
  return result;
}

function validateScenario(scenario: {
  id: string;
  steps: readonly { sequence: number; atUs: number; action: string }[];
  capture: { startUs: number; endUs: number; fps: number };
}): void {
  if (
    !/^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9-]*)+$/.test(scenario.id) ||
    scenario.steps.length > 10_000 ||
    !Number.isSafeInteger(scenario.capture.startUs) ||
    !Number.isSafeInteger(scenario.capture.endUs) ||
    scenario.capture.startUs < 0 ||
    scenario.capture.endUs < scenario.capture.startUs ||
    scenario.capture.endUs - scenario.capture.startUs > 10_000_000 ||
    !Number.isInteger(scenario.capture.fps) ||
    scenario.capture.fps < 1 ||
    scenario.capture.fps > 120
  ) {
    throw new ServiceError(
      'INVALID_REQUEST',
      'Scenario limits or identity are invalid.',
      400,
      false,
    );
  }
}

declare global {
  var __studioLastFrame: PreviewRuntimeFrame | null | undefined;
  var __studioResetRequested: boolean | undefined;
  var __studioDeterministicTimeUs: number | null | undefined;
  var __studioCaptureRequest: { requestId: string } | null | undefined;
  var __studioLastCaptureBytes: ArrayBuffer | null | undefined;
  /** Runtime frame installed by the Emscripten browser host after each render. */
  function readRuntimeFrame(): PreviewRuntimeFrame | null;
}
