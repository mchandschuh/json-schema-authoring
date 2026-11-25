import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createJsonSchemaRegistry,
  getDefaultJsonSchemaRegistry,
  type JsonSchemaRegistry,
} from '../src/index.js';

const dialect = 'https://json-schema.org/draft/2020-12/schema';

async function fixture(): Promise<{
  readonly rootPath: string;
  readonly schemas: string;
  readonly childId: string;
  readonly rootSchema: Record<string, unknown>;
}> {
  const root = await mkdtemp(join(tmpdir(), 'json-schema-registry-'));
  const documents = join(root, 'documents');
  const schemas = join(root, 'schemas');
  await mkdir(documents, { recursive: true });
  await mkdir(schemas, { recursive: true });

  const childId = 'https://schemas.example.test/facade/child/v1';
  const rootPath = join(documents, 'root.schema.json');
  const rootSchema = {
    $schema: dialect,
    $id: 'https://schemas.example.test/facade/root/v1',
    title: 'Facade root',
    description: 'A schema used by the public registry facade tests.',
    type: 'object',
    properties: {
      name: { $ref: childId },
    },
    required: ['name'],
    additionalProperties: false,
    examples: [{ name: 'Ada' }],
  };

  await Promise.all([
    writeFile(join(schemas, 'child.schema.json'), JSON.stringify({
      $schema: dialect,
      $id: childId,
      title: 'Child',
      description: 'A name resolved by the public facade.',
      type: 'string',
      minLength: 1,
      examples: ['Ada'],
    }), 'utf8'),
    writeFile(rootPath, JSON.stringify(rootSchema), 'utf8'),
  ]);

  return { rootPath, schemas, childId, rootSchema };
}

function options(rootPath: string, schemas: string) {
  return { documentPath: rootPath, schemaRoots: [schemas] };
}

describe('JsonSchemaRegistry public facade', () => {
  it('creates isolated registries and exposes a stable default singleton', () => {
    const first = createJsonSchemaRegistry();
    const second = createJsonSchemaRegistry();

    expect(first).toBeInstanceOf(Object);
    expect(first).not.toBe(second);
    expect(getDefaultJsonSchemaRegistry()).toBe(getDefaultJsonSchemaRegistry());
  });

  it('resolves one and many external schemas synchronously and asynchronously', async () => {
    const fixtureValue = await fixture();
    const registry = createJsonSchemaRegistry({ schemaRoots: [fixtureValue.schemas] });
    const context = options(fixtureValue.rootPath, fixtureValue.schemas);

    expect(registry.resolveSync(fixtureValue.childId, context)).toMatchObject({
      canonicalUri: fixtureValue.childId,
      schema: { $id: fixtureValue.childId },
    });
    expect(registry.resolveManySync([fixtureValue.childId, fixtureValue.childId], context)).toHaveLength(2);
    await expect(registry.resolve(fixtureValue.childId, context)).resolves.toMatchObject({
      canonicalUri: fixtureValue.childId,
    });
    await expect(registry.resolveMany([fixtureValue.childId], context)).resolves.toMatchObject([
      { canonicalUri: fixtureValue.childId },
    ]);
  });

  it('validates schemas with external references through sync and async public methods', async () => {
    const fixtureValue = await fixture();
    const registry = createJsonSchemaRegistry({ schemaRoots: [fixtureValue.schemas], rules: [] });
    const validationOptions = options(fixtureValue.rootPath, fixtureValue.schemas);

    expect(registry.validateSchema(fixtureValue.rootSchema, validationOptions)).toEqual({
      path: fixtureValue.rootPath,
      valid: true,
      findings: [],
    });
    await expect(registry.validateSchemaAsync(fixtureValue.rootSchema, validationOptions)).resolves.toEqual({
      path: fixtureValue.rootPath,
      valid: true,
      findings: [],
    });
  });

  it('validates instances with external references through sync and async public methods', async () => {
    const fixtureValue = await fixture();
    const registry = createJsonSchemaRegistry({ schemaRoots: [fixtureValue.schemas] });
    const validationOptions = options(fixtureValue.rootPath, fixtureValue.schemas);

    expect(registry.validateInstance(fixtureValue.rootSchema, { name: 'Ada' }, validationOptions)).toEqual({
      valid: true,
      errors: [],
    });
    expect(registry.validateInstance(fixtureValue.rootSchema, { name: '' }, validationOptions).valid).toBe(false);
    await expect(registry.validateInstanceAsync(fixtureValue.rootSchema, { name: 'Ada' }, validationOptions)).resolves.toEqual({
      valid: true,
      errors: [],
    });
    await expect(registry.validateInstanceAsync(fixtureValue.rootSchema, { name: '' }, validationOptions)).resolves.toMatchObject({
      valid: false,
    });
  });

  it('finds externally registered schemas through the facade catalog method', async () => {
    const fixtureValue = await fixture();
    const registry: JsonSchemaRegistry = createJsonSchemaRegistry({ schemaRoots: [fixtureValue.schemas] });

    await expect(registry.find({ schemaUri: fixtureValue.childId })).resolves.toMatchObject({
      id: fixtureValue.childId,
      schema: { $id: fixtureValue.childId },
    });
  });
});