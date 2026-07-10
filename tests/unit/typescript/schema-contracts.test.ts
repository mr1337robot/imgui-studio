import { readFileSync, readdirSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ajv2020, type AnySchema, type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const schemasRoot = resolve(repositoryRoot, 'schemas');
const fixturesRoot = resolve(repositoryRoot, 'tests/fixtures/schemas');
const ajv = new Ajv2020({ allErrors: true, strict: true, validateFormats: false });

const validators = loadValidators();

describe('v1 JSON Schema contracts', () => {
  it('validates the pinned toolchain manifest against its schema', () => {
    const schema = readJson(
      resolve(repositoryRoot, 'toolchain/toolchain.schema.json'),
    ) as AnySchema;
    const manifest = readJson(resolve(repositoryRoot, 'toolchain/toolchain.json'));
    const validator = ajv.compile(schema);
    expect(validator(manifest), formatErrors(validator.errors)).toBe(true);
  });

  it('declares explicit schema metadata and a v1 discriminator', () => {
    for (const [name, validator] of validators) {
      const schema = validator.schema as Record<string, unknown>;
      expect(schema.$schema, name).toBe('https://json-schema.org/draft/2020-12/schema');
      expect(schema.$id, name).toMatch(/^https:\/\/imgui\.studio\/schemas\//);
      expect(schema.properties, name).toHaveProperty('schemaVersion');
      expect(
        (schema.properties as Record<string, Record<string, unknown>>).schemaVersion?.const,
        name,
      ).toBe(1);
    }
  });

  for (const fixtureName of listJsonFiles(resolve(fixturesRoot, 'valid'))) {
    it(`accepts valid fixture ${fixtureName}`, () => {
      const fixture = readJson(resolve(fixturesRoot, 'valid', fixtureName)) as FixtureEnvelope;
      const validator = requireValidator(fixture.schema);
      expect(validator(fixture.document), formatErrors(validator.errors)).toBe(true);
    });
  }

  for (const fixtureName of listJsonFiles(resolve(fixturesRoot, 'invalid'))) {
    it(`rejects invalid fixture ${fixtureName} at the expected keyword`, () => {
      const fixture = readJson(
        resolve(fixturesRoot, 'invalid', fixtureName),
      ) as InvalidFixtureEnvelope;
      const validator = requireValidator(fixture.schema);
      expect(validator(fixture.document)).toBe(false);
      expect(validator.errors?.some((error) => error.keyword === fixture.expectedKeyword)).toBe(
        true,
      );
    });
  }
});

interface FixtureEnvelope {
  readonly schema: string;
  readonly document: unknown;
}

interface InvalidFixtureEnvelope extends FixtureEnvelope {
  readonly expectedKeyword: string;
}

function loadValidators(): Map<string, ValidateFunction> {
  const result = new Map<string, ValidateFunction>();
  for (const schemaPath of findSchemas(schemasRoot)) {
    const schema = readJson(schemaPath) as AnySchema;
    result.set(basename(schemaPath), ajv.compile(schema));
  }
  return result;
}

function requireValidator(name: string): ValidateFunction {
  const validator = validators.get(name);
  if (!validator) {
    throw new Error(`Fixture references unknown schema '${name}'.`);
  }
  return validator;
}

function findSchemas(directory: string): string[] {
  const paths: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory() && entry.name !== 'generated') {
      paths.push(...findSchemas(path));
    } else if (entry.isFile() && entry.name.endsWith('.schema.json')) {
      paths.push(path);
    }
  }
  return paths.sort();
}

function listJsonFiles(directory: string): string[] {
  return readdirSync(directory)
    .filter((name) => name.endsWith('.json'))
    .sort();
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function formatErrors(errors: ErrorObject[] | null | undefined): string {
  return JSON.stringify(errors ?? [], null, 2);
}
