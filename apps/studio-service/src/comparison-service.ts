/**
 * Owns bounded reference decoding and deterministic pixel comparison. Reference transforms are
 * metadata applied to immutable pixels; source images are never destructively rewritten.
 */
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import pngjs from 'pngjs';
import type { PreviewCoordinator } from './preview-coordinator.ts';
import type { ProjectService } from './project-service.ts';
import { ServiceError } from './service-error.ts';
import type { ImageArtifact } from './types.ts';

const { PNG } = pngjs;
const maximumReferenceBytes = 10 * 1024 * 1024;
const maximumDimensionPx = 8192;

type ComparisonMode = 'sideBySide' | 'alphaOverlay' | 'absoluteDifference' | 'edgeDifference';

interface ReferenceRecord {
  readonly referenceId: string;
  readonly sha256: string;
  readonly mediaType: 'image/png' | 'image/jpeg' | 'image/webp';
  readonly normalizedPng: Buffer;
  readonly widthPx: number;
  readonly heightPx: number;
}

export interface ComparisonTransform {
  readonly translateMicroPx: readonly [number, number];
  readonly scaleMillionths: number;
  readonly cropPx: readonly [number, number, number, number] | null;
  readonly opacityMillionths: number;
}

/** Imports references and creates attributable comparison artifacts for one project. */
export class ComparisonService {
  readonly #references = new Map<string, ReferenceRecord>();

  public constructor(
    private readonly project: ProjectService,
    private readonly previews: PreviewCoordinator,
  ) {}

  /** Validates magic bytes, decodes under dimension limits, and stores a normalized immutable PNG. */
  public async importReference(
    referenceId: string,
    mediaType: unknown,
    bytes: Buffer,
  ): Promise<Omit<ReferenceRecord, 'normalizedPng'>> {
    if (!/^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9-]*)+$/.test(referenceId)) {
      throw new ServiceError('ASSET_INVALID', 'Reference ID is invalid.', 400, false);
    }
    if (bytes.length === 0 || bytes.length > maximumReferenceBytes) {
      throw new ServiceError('LIMIT_EXCEEDED', 'Reference byte limit exceeded.', 413, false);
    }
    const detected = detectMediaType(bytes);
    if (mediaType !== detected) {
      throw new ServiceError(
        'ASSET_INVALID',
        'Reference content does not match mediaType.',
        400,
        false,
      );
    }
    const decoded = await decodeToPng(bytes, detected);
    if (
      decoded.width <= 0 ||
      decoded.height <= 0 ||
      decoded.width > maximumDimensionPx ||
      decoded.height > maximumDimensionPx
    ) {
      throw new ServiceError(
        'LIMIT_EXCEEDED',
        'Decoded reference dimensions exceed limits.',
        413,
        false,
      );
    }
    const normalizedPng = PNG.sync.write(decoded);
    const record: ReferenceRecord = {
      referenceId,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      mediaType: detected,
      normalizedPng,
      widthPx: decoded.width,
      heightPx: decoded.height,
    };
    this.#references.set(referenceId, record);
    const directory = resolve(this.project.root, '.studio', 'references');
    await mkdir(directory, { recursive: true });
    const storageKey = referenceId.replaceAll('.', '_');
    await writeFile(resolve(directory, `${storageKey}.png`), normalizedPng);
    await writeFile(
      resolve(directory, `${storageKey}.json`),
      `${JSON.stringify({
        schemaVersion: 1,
        referenceId,
        sha256: record.sha256,
        mediaType: record.mediaType,
        widthPx: record.widthPx,
        heightPx: record.heightPx,
      })}\n`,
    );
    return {
      referenceId: record.referenceId,
      sha256: record.sha256,
      mediaType: record.mediaType,
      widthPx: record.widthPx,
      heightPx: record.heightPx,
    };
  }

  /** Creates side-by-side, overlay, absolute, or edge difference output with exact provenance. */
  public async compare(
    captureArtifactId: string,
    referenceId: string,
    mode: ComparisonMode,
    transform: ComparisonTransform,
  ): Promise<{
    comparisonId: string;
    mode: ComparisonMode;
    transform: ComparisonTransform;
    captureSha256: string;
    referenceSha256: string;
    artifact: ImageArtifact;
    metrics: { meanAbsoluteErrorMillionths: number; differingPixels: number };
  }> {
    const reference = await this.#loadReference(referenceId);
    if (!reference) {
      throw new ServiceError('REFERENCE_NOT_FOUND', 'Reference is unknown.', 404, false);
    }
    validateTransform(transform);
    const captureBytes = await this.previews.readArtifact(captureArtifactId);
    const capture = PNG.sync.read(captureBytes);
    const sourceReference = PNG.sync.read(reference.normalizedPng);
    const aligned = alignReference(sourceReference, capture.width, capture.height, transform);
    const result = compose(capture, aligned, mode, transform.opacityMillionths);
    const bytes = PNG.sync.write(result.output);
    return {
      comparisonId: `cmp_${randomUUID()}`,
      mode,
      transform,
      captureSha256: createHash('sha256').update(captureBytes).digest('hex'),
      referenceSha256: reference.sha256,
      artifact: await this.previews.storeArtifact(bytes, result.output.width, result.output.height),
      metrics: result.metrics,
    };
  }

  async #loadReference(referenceId: string): Promise<ReferenceRecord | undefined> {
    const resident = this.#references.get(referenceId);
    if (resident) return resident;
    if (!/^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9-]*)+$/.test(referenceId)) return undefined;
    const directory = resolve(this.project.root, '.studio', 'references');
    const storageKey = referenceId.replaceAll('.', '_');
    try {
      const metadata = JSON.parse(
        await readFile(resolve(directory, `${storageKey}.json`), 'utf8'),
      ) as Partial<Omit<ReferenceRecord, 'normalizedPng'>>;
      const normalizedPng = await readFile(resolve(directory, `${storageKey}.png`));
      if (
        metadata.referenceId !== referenceId ||
        typeof metadata.sha256 !== 'string' ||
        !isReferenceMediaType(metadata.mediaType) ||
        typeof metadata.widthPx !== 'number' ||
        typeof metadata.heightPx !== 'number' ||
        !Number.isSafeInteger(metadata.widthPx) ||
        !Number.isSafeInteger(metadata.heightPx)
      )
        return undefined;
      const record: ReferenceRecord = {
        referenceId,
        sha256: metadata.sha256,
        mediaType: metadata.mediaType,
        widthPx: metadata.widthPx,
        heightPx: metadata.heightPx,
        normalizedPng,
      };
      this.#references.set(referenceId, record);
      return record;
    } catch {
      return undefined;
    }
  }
}

function isReferenceMediaType(value: unknown): value is ReferenceRecord['mediaType'] {
  return value === 'image/png' || value === 'image/jpeg' || value === 'image/webp';
}

function detectMediaType(bytes: Buffer): ReferenceRecord['mediaType'] {
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9)
    return 'image/jpeg';
  if (
    bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
    bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  )
    return 'image/webp';
  throw new ServiceError('ASSET_INVALID', 'Unsupported or malformed image magic.', 400, false);
}

async function decodeToPng(
  bytes: Buffer,
  mediaType: ReferenceRecord['mediaType'],
): Promise<InstanceType<typeof PNG>> {
  if (mediaType === 'image/png') {
    try {
      return PNG.sync.read(bytes);
    } catch {
      throw new ServiceError('ASSET_INVALID', 'PNG decode failed.', 400, false);
    }
  }
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(
      `<img id="reference" src="data:${mediaType};base64,${bytes.toString('base64')}">`,
    );
    const image = page.locator('#reference');
    await image.waitFor({ state: 'visible' });
    return PNG.sync.read(await image.screenshot({ type: 'png' }));
  } catch {
    throw new ServiceError('ASSET_INVALID', 'Reference decode failed.', 400, false);
  } finally {
    await browser.close();
  }
}

function validateTransform(transform: ComparisonTransform): void {
  if (
    !Array.isArray(transform.translateMicroPx) ||
    !transform.translateMicroPx.every(Number.isSafeInteger) ||
    !Number.isSafeInteger(transform.scaleMillionths) ||
    transform.scaleMillionths <= 0 ||
    transform.scaleMillionths > 8_000_000 ||
    !Number.isSafeInteger(transform.opacityMillionths) ||
    transform.opacityMillionths < 0 ||
    transform.opacityMillionths > 1_000_000 ||
    (transform.cropPx !== null &&
      (!transform.cropPx.every(Number.isSafeInteger) ||
        transform.cropPx[0] < 0 ||
        transform.cropPx[1] < 0 ||
        transform.cropPx[2] <= 0 ||
        transform.cropPx[3] <= 0))
  )
    throw new ServiceError('INVALID_REQUEST', 'Comparison transform is invalid.', 400, false);
}

function alignReference(
  source: InstanceType<typeof PNG>,
  width: number,
  height: number,
  transform: ComparisonTransform,
): InstanceType<typeof PNG> {
  const output = new PNG({ width, height });
  const scale = transform.scaleMillionths / 1_000_000;
  const translateX = transform.translateMicroPx[0] / 1_000_000;
  const translateY = transform.translateMicroPx[1] / 1_000_000;
  const crop = transform.cropPx ?? [0, 0, source.width, source.height];
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) {
      const sx = Math.floor((x - translateX) / scale) + crop[0],
        sy = Math.floor((y - translateY) / scale) + crop[1];
      if (
        sx < crop[0] ||
        sy < crop[1] ||
        sx >= crop[0] + crop[2] ||
        sy >= crop[1] + crop[3] ||
        sx >= source.width ||
        sy >= source.height
      )
        continue;
      const from = (sy * source.width + sx) * 4,
        to = (y * width + x) * 4;
      source.data.copy(output.data, to, from, from + 4);
    }
  return output;
}

function compose(
  capture: InstanceType<typeof PNG>,
  reference: InstanceType<typeof PNG>,
  mode: ComparisonMode,
  opacityMillionths: number,
): {
  output: InstanceType<typeof PNG>;
  metrics: { meanAbsoluteErrorMillionths: number; differingPixels: number };
} {
  const output = new PNG({
    width: mode === 'sideBySide' ? capture.width * 2 : capture.width,
    height: capture.height,
  });
  let absoluteSum = 0,
    differingPixels = 0;
  const opacity = opacityMillionths / 1_000_000;
  for (let y = 0; y < capture.height; y += 1) {
    for (let x = 0; x < capture.width; x += 1) {
      const sourceAt = (y * capture.width + x) * 4;
      const previewAt = (y * output.width + x) * 4;
      const referenceAt = (y * output.width + capture.width + x) * 4;
      let differs = false;
      for (let channel = 0; channel < 3; channel += 1) {
        const previewValue = byteAt(capture.data, sourceAt + channel);
        const referenceValue = byteAt(reference.data, sourceAt + channel);
        const difference = Math.abs(previewValue - referenceValue);
        absoluteSum += difference;
        differs ||= difference !== 0;
        if (mode === 'alphaOverlay') {
          output.data[previewAt + channel] = Math.round(
            previewValue * (1 - opacity) + referenceValue * opacity,
          );
        } else if (mode === 'absoluteDifference' || mode === 'edgeDifference') {
          output.data[previewAt + channel] =
            mode === 'edgeDifference' ? (difference > 24 ? 255 : 0) : difference;
        } else {
          output.data[previewAt + channel] = previewValue;
          output.data[referenceAt + channel] = referenceValue;
        }
      }
      output.data[previewAt + 3] = 255;
      if (mode === 'sideBySide') output.data[referenceAt + 3] = 255;
      if (differs) differingPixels += 1;
    }
  }
  return {
    output,
    metrics: {
      meanAbsoluteErrorMillionths: Math.round(
        (absoluteSum * 1_000_000) / (capture.width * capture.height * 3 * 255),
      ),
      differingPixels,
    },
  };
}

function byteAt(bytes: Buffer, index: number): number {
  return bytes[index] ?? 0;
}
