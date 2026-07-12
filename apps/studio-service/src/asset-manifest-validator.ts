/**
 * Validates project-declared portable assets before a build worker sees them.
 *
 * This module owns manifest syntax, logical asset identity, and inexpensive content checks. It
 * deliberately does not decode, upload, or retain renderer textures: those responsibilities stay
 * at the browser/native host boundary. The bounded checks here prevent malformed declarations and
 * obviously unsafe SVG/image/font input from becoming opaque compiler failures.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Ajv2020, type ValidateFunction } from 'ajv/dist/2020.js';
import { resolveConfinedPath } from './filesystem.ts';
import { ServiceError } from './service-error.ts';

const maximumManifestBytes = 256 * 1024;
const maximumSvgBytes = 256 * 1024;
const maximumRasterBytes = 16 * 1024 * 1024;
const maximumFontBytes = 32 * 1024 * 1024;
const maximumLicenseBytes = 256 * 1024;

interface AssetDeclaration {
  readonly id: string;
  readonly kind: 'texture' | 'font' | 'svgIcon';
  readonly source: string;
  readonly licenseFiles: readonly string[];
}

interface AssetManifest {
  readonly schemaVersion: 1;
  readonly assets: readonly AssetDeclaration[];
}

/** Validates every file referenced by a project's versioned asset manifest. */
export class AssetManifestValidator {
  readonly #schemaValidator: ValidateFunction;

  private constructor(schemaValidator: ValidateFunction) {
    this.#schemaValidator = schemaValidator;
  }

  /** Loads the pinned v1 schema once for one project-service instance. */
  public static async create(repositoryRoot: string): Promise<AssetManifestValidator> {
    const schema = JSON.parse(
      await readFile(resolve(repositoryRoot, 'schemas/project/assets.schema.json'), 'utf8'),
    ) as object;
    const schemaValidator = new Ajv2020({
      allErrors: true,
      strict: true,
      validateFormats: false,
    }).compile(schema);
    return new AssetManifestValidator(schemaValidator);
  }

  /**
   * Rejects malformed, missing, oversized, duplicate, or unsafe portable asset inputs.
   *
   * No bytes leave the project root. Error details contain only logical paths and stable asset IDs
   * so this boundary does not disclose host paths or source content.
   */
  public async validate(projectRoot: string, manifestLogicalPath: string): Promise<void> {
    const manifestPath = await resolveConfinedPath(projectRoot, manifestLogicalPath);
    const manifestText = await readBounded(
      manifestPath.absolutePath,
      maximumManifestBytes,
      manifestLogicalPath,
    );
    let manifest: unknown;
    try {
      manifest = JSON.parse(manifestText.toString('utf8'));
    } catch {
      throw assetInvalid('Asset manifest is not valid UTF-8 JSON.', { path: manifestLogicalPath });
    }
    if (!this.#schemaValidator(manifest)) {
      throw assetInvalid('Asset manifest failed schema validation.', {
        path: manifestLogicalPath,
        errors: this.#schemaValidator.errors?.slice(0, 16),
      });
    }

    const typed = manifest as AssetManifest;
    const ids = new Set<string>();
    for (const asset of typed.assets) {
      if (ids.has(asset.id)) {
        throw assetInvalid('Asset identifiers must be unique.', { assetId: asset.id });
      }
      ids.add(asset.id);
      const source = await resolveDeclaredAssetPath(projectRoot, asset.source);
      const sourceBytes = await readBounded(
        source.absolutePath,
        limitFor(asset.kind),
        asset.source,
      );
      validateSource(asset, sourceBytes);
      for (const licensePath of asset.licenseFiles) {
        const license = await resolveDeclaredAssetPath(projectRoot, licensePath);
        const licenseBytes = await readBounded(
          license.absolutePath,
          maximumLicenseBytes,
          licensePath,
        );
        if (licenseBytes.length === 0) {
          throw assetInvalid('An asset license file must not be empty.', {
            assetId: asset.id,
            path: licensePath,
          });
        }
      }
    }
  }
}

function limitFor(kind: AssetDeclaration['kind']): number {
  switch (kind) {
    case 'svgIcon':
      return maximumSvgBytes;
    case 'texture':
      return maximumRasterBytes;
    case 'font':
      return maximumFontBytes;
  }
}

function validateSource(asset: AssetDeclaration, bytes: Buffer): void {
  switch (asset.kind) {
    case 'svgIcon':
      validateSvg(asset, bytes);
      return;
    case 'texture':
      if (!isRasterImage(bytes)) {
        throw assetInvalid('Texture bytes are not PNG, JPEG, or WebP.', {
          assetId: asset.id,
          path: asset.source,
        });
      }
      return;
    case 'font':
      if (!isFont(bytes)) {
        throw assetInvalid(
          'Font bytes are not a supported OpenType, TrueType, TTC, or WOFF font.',
          {
            assetId: asset.id,
            path: asset.source,
          },
        );
      }
  }
}

function validateSvg(asset: AssetDeclaration, bytes: Buffer): void {
  let svg: string;
  try {
    svg = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw assetInvalid('SVG must be UTF-8.', { assetId: asset.id, path: asset.source });
  }
  const forbidden =
    /<\s*(?:script|foreignObject|iframe|object|embed|image|animate(?:Motion|Transform)?|set)\b|<!\s*(?:ENTITY|DOCTYPE)|\b(?:href|xlink:href)\s*=\s*["']\s*(?:https?:|data:|file:|javascript:)/i;
  if (!/^\s*<svg\b/i.test(svg) || forbidden.test(svg)) {
    throw assetInvalid('SVG contains unsupported active or external content.', {
      assetId: asset.id,
      path: asset.source,
    });
  }
}

function isRasterImage(bytes: Buffer): boolean {
  const png =
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const webp =
    bytes.length >= 12 &&
    bytes.subarray(0, 4).equals(Buffer.from('RIFF')) &&
    bytes.subarray(8, 12).equals(Buffer.from('WEBP'));
  return png || jpeg || webp;
}

function isFont(bytes: Buffer): boolean {
  if (bytes.length < 4) return false;
  const tag = bytes.subarray(0, 4).toString('ascii');
  return (
    tag === 'OTTO' ||
    tag === 'ttcf' ||
    tag === 'wOFF' ||
    bytes.subarray(0, 4).equals(Buffer.from([0, 1, 0, 0]))
  );
}

async function readBounded(
  path: string,
  maximumBytes: number,
  logicalPath: string,
): Promise<Buffer> {
  let bytes: Buffer;
  try {
    bytes = await readFile(path);
  } catch {
    throw assetInvalid('A declared asset file does not exist.', { path: logicalPath });
  }
  if (bytes.length > maximumBytes) {
    throw assetInvalid('Asset input exceeds the configured size limit.', {
      path: logicalPath,
      maximumBytes,
    });
  }
  return bytes;
}

/**
 * Converts a missing declared file into the asset-domain error while preserving a confinement
 * failure from the filesystem boundary. This avoids leaking host paths yet keeps a traversal
 * attempt distinct from an incomplete asset graph.
 */
async function resolveDeclaredAssetPath(
  projectRoot: string,
  logicalPath: string,
): Promise<{ logicalPath: string; absolutePath: string }> {
  try {
    return await resolveConfinedPath(projectRoot, logicalPath);
  } catch (error) {
    if (error instanceof ServiceError && error.code === 'FILE_NOT_FOUND') {
      throw assetInvalid('A declared asset file does not exist.', { path: logicalPath });
    }
    throw error;
  }
}

function assetInvalid(message: string, details: Record<string, unknown>): ServiceError {
  return new ServiceError('ASSET_INVALID', message, 400, false, details);
}
