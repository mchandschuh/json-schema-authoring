import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  listRegisteredSchemas,
  listRegisteredSchemasSync,
  SchemaRegistryConfiguration,
} from '../src/core/schema/registry.js';
import { resolveRegisteredSchema } from '../src/core/schema/resolve.js';
import { validateInstance, validateInstanceAsync } from '../src/core/schema/instance.js';
import { SchemaValidator, validateSchema } from '../src/core/schema/validator.js';

const childSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://schemas.example.test/common/v1/name',
  title: 'Name',
  description: 'A name shared by registered schemas.',
  type: 'string',
  minLength: 1,
  examples: ['Ada'],
};

async function directoriesFixture(): Promise<{ root: string; app: string; home: string; env: string; schemas: string }> {
  const root = await mkdtemp(join(tmpdir(), 'schema-registry-'));
  const app = join(root, 'app');
  const home = join(root, 'home');
  const env = join(root, 'env');
  const schemas = join(root, 'schemas');
  await mkdir(schemas, { recursive: true });
  await mkdir(env, { recursive: true });
  await writeFile(join(schemas, 'name.schema.json'), JSON.stringify(childSchema), 'utf8');
  return { root, app, home, env, schemas };
}

async function externalReferenceFixture(): Promise<{
  readonly root: string;
  readonly schemas: string;
  readonly rootPath: string;
  readonly childSchema: Record<string, unknown>;
  readonly rootSchema: Record<string, unknown>;
  readonly configuration: SchemaRegistryConfiguration;
}> {
  const fixture = await directoriesFixture();
  const configuration = new SchemaRegistryConfiguration({
    cwd: fixture.app,
    homeDirectory: fixture.home,
    environment: {},
  });

  await configuration.add(fixture.schemas, 'home');

  const rootPath = join(fixture.root, 'root.schema.json');
  const rootSchema = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://schemas.example.test/root/v1/root',
    title: 'Root',
    description: 'A root schema that references a registered schema.',
    type: 'object',
    properties: {
      name: { $ref: childSchema.$id },
    },
    required: ['name'],
    additionalProperties: false,
  };
  await writeFile(rootPath, JSON.stringify(rootSchema), 'utf8');

  return {
    root: fixture.root,
    schemas: fixture.schemas,
    rootPath,
    childSchema,
    rootSchema,
    configuration,
  };
}

describe('schema registry configuration', () => {
  it('supports app, home, and environment locations with all-location listing', async () => {
    const fixture = await directoriesFixture();
    const configuration = new SchemaRegistryConfiguration({
      cwd: fixture.app,
      homeDirectory: fixture.home,
      environment: { SDLC_CONFIG: fixture.env },
    });

    await configuration.add(fixture.schemas, 'app');
    await configuration.add(fixture.schemas, 'home');
    await configuration.add(fixture.schemas, 'env');

    const entries = await configuration.list('all');
    expect(entries.map((entry) => entry.location)).toEqual(['app', 'env', 'home']);
    expect(entries.every((entry) => entry.directory === fixture.schemas)).toBe(true);
    expect((await configuration.list('home')).map((entry) => entry.location)).toEqual(['home']);

    const removed = await configuration.remove(fixture.schemas, 'home');
    expect(removed.removed).toBe(true);
    expect((await configuration.list('all')).map((entry) => entry.location)).toEqual(['app', 'env']);
  });

  it('lists schemas with their registered directory', async () => {
    const fixture = await directoriesFixture();
    const configuration = new SchemaRegistryConfiguration({ cwd: fixture.app, homeDirectory: fixture.home, environment: {} });
    await configuration.add(fixture.schemas, 'home');

    const entries = await configuration.list('all');
    await expect(listRegisteredSchemas(entries)).resolves.toEqual([{
      id: childSchema.$id,
      path: join(fixture.schemas, 'name.schema.json'),
      directory: fixture.schemas,
      locations: ['home'],
    }]);
    expect(listRegisteredSchemasSync(configuration.listSync('all'))).toEqual([{
      id: childSchema.$id,
      path: join(fixture.schemas, 'name.schema.json'),
      directory: fixture.schemas,
      locations: ['home'],
    }]);
  });
});

describe('registered schema reference resolution', () => {
  it('resolves a registered schema by absolute identifier during schema validation', async () => {
    const fixture = await directoriesFixture();
    const rootPath = join(fixture.root, 'root.schema.json');
    await writeFile(rootPath, JSON.stringify({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $id: 'https://schemas.example.test/root/v1/root',
      title: 'Root',
      description: 'A root schema that references a registered schema.',
      type: 'object',
      properties: {
        name: { $ref: childSchema.$id, description: 'The shared name.', examples: ['Ada'] },
      },
      required: ['name'],
      additionalProperties: false,
      examples: [{ name: 'Ada' }],
    }), 'utf8');

    await expect(new SchemaValidator({ schemaRoots: [fixture.schemas] }).validateFile(rootPath)).resolves.toMatchObject({ valid: true, findings: [] });
  });

  it('resolves a registered schema by absolute identifier during instance validation', async () => {
    const fixture = await directoriesFixture();
    const rootPath = join(fixture.root, 'instance-root.schema.json');
    const schema = {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $id: 'https://schemas.example.test/root/v1/instance-root',
      type: 'object',
      properties: { name: { $ref: childSchema.$id } },
      required: ['name'],
      additionalProperties: false,
    };
    await writeFile(rootPath, JSON.stringify(schema), 'utf8');

    await expect(validateInstanceAsync(schema, { name: 'Ada' }, { documentPath: rootPath, schemaRoots: [fixture.schemas] })).resolves.toEqual({ valid: true, errors: [] });
    await expect(validateInstanceAsync(schema, { name: '' }, { documentPath: rootPath, schemaRoots: [fixture.schemas] })).resolves.toMatchObject({ valid: false });
  });

  it('does not let an unrelated older-dialect registered schema break validation', async () => {
    const fixture = await directoriesFixture();
    const legacyDirectory = join(fixture.root, 'legacy');
    await mkdir(legacyDirectory, { recursive: true });
    await writeFile(join(legacyDirectory, 'legacy.schema.json'), JSON.stringify({
      $schema: 'http://json-schema.org/draft-07/schema#',
      $id: 'https://schemas.example.test/legacy/v1',
      type: 'string',
    }), 'utf8');
    const rootPath = join(fixture.root, 'unrelated-root.schema.json');
    const schema = {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $id: 'https://schemas.example.test/root/v1/unrelated-root',
      title: 'Unrelated root',
      description: 'A schema that should not be affected by an older dialect.',
      type: 'string',
      examples: ['valid'],
    };
    await writeFile(rootPath, JSON.stringify(schema), 'utf8');

    await expect(new SchemaValidator({ schemaRoots: [legacyDirectory] }).validateFile(rootPath)).resolves.toMatchObject({ valid: true, findings: [] });
  });

  it('synchronously validates a schema with a registry-accessible external reference', async () => {
    const fixture = await externalReferenceFixture();

    await expect(
      resolveRegisteredSchema(fixture.childSchema.$id as string, { configuration: fixture.configuration }),
    ).resolves.toMatchObject({ schema: fixture.childSchema });

    const report = validateSchema(fixture.rootSchema, {
      documentPath: fixture.rootPath,
      schemaRoots: [fixture.schemas],
      rules: [],
    });

    expect(report).toEqual({
      path: fixture.rootPath,
      valid: true,
      findings: [],
    });
  });

  it('synchronously validates an instance against a schema with a registry-accessible external reference', async () => {
    const fixture = await externalReferenceFixture();

    await expect(
      resolveRegisteredSchema(fixture.childSchema.$id as string, { configuration: fixture.configuration }),
    ).resolves.toMatchObject({ schema: fixture.childSchema });

    const report = validateInstance(fixture.rootSchema, { name: 'Ada' }, {
      documentPath: fixture.rootPath,
      schemaRoots: [fixture.schemas],
    });

    expect(report).toEqual({ valid: true, errors: [] });
  });
});