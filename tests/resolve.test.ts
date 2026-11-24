import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SchemaRegistryConfiguration } from '../src/core/schema/registry.js';
import {
  resolveRegisteredSchema,
  resolveRegisteredSchemaSync,
  resolveRegisteredSchemas,
  resolveRegisteredSchemasSync,
  SchemaResolutionError,
} from '../src/core/schema/resolve.js';

async function fixture(): Promise<{ root: string; configuration: SchemaRegistryConfiguration; schemas: string }> {
  const root = await mkdtemp(join(tmpdir(), 'schema-resolve-'));
  const app = join(root, 'app');
  const home = join(root, 'home');
  const schemas = join(root, 'schemas');
  await mkdir(schemas, { recursive: true });
  const configuration = new SchemaRegistryConfiguration({ cwd: app, homeDirectory: home, environment: {} });
  await configuration.add(schemas, 'home');
  return { root, configuration, schemas };
}

async function schemaFile(directory: string, name: string, id: string): Promise<string> {
  const path = join(directory, name);
  await writeFile(path, JSON.stringify({
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: id,
    title: name,
    type: 'object',
  }), 'utf8');
  return path;
}

describe('registered schema resolution', () => {
  it.each([
    'https://schemas.handschuh.dev/sdlc/task-envelope/v1',
    'sdlc/task-envelope/v1',
    'task-envelope/v1',
    'task-envelope',
  ])('resolves %s from the local registry listing', async (searchString) => {
    const { configuration, schemas } = await fixture();
    const path = await schemaFile(schemas, 'task-envelope.schema.json', 'https://schemas.handschuh.dev/sdlc/task-envelope/v1');

    await expect(resolveRegisteredSchema(searchString, { configuration })).resolves.toMatchObject({
      id: 'https://schemas.handschuh.dev/sdlc/task-envelope/v1',
      path,
      schema: { $id: 'https://schemas.handschuh.dev/sdlc/task-envelope/v1' },
    });
  });

  it('matches schema IDs from any registered authority', async () => {
    const { configuration, schemas } = await fixture();
    const path = await schemaFile(schemas, 'commit-manifest.schema.json', 'https://schemas.1konto.dev/devops-google/commit-specs/commit-manifest.schema.json');

    await expect(resolveRegisteredSchema('commit-manifest.schema.json', { configuration })).resolves.toMatchObject({ path });
  });

  it('resolves one schema synchronously from the local registry', async () => {
    const { configuration, schemas } = await fixture();
    const path = await schemaFile(schemas, 'sync.schema.json', 'https://schemas.example.test/sync/v1');

    expect(resolveRegisteredSchemaSync('https://schemas.example.test/sync/v1', { configuration })).toMatchObject({
      id: 'https://schemas.example.test/sync/v1',
      path,
      schema: { $id: 'https://schemas.example.test/sync/v1' },
    });
  });

  it('resolves multiple schemas in input order across configured and explicit roots', async () => {
    const { root, configuration, schemas } = await fixture();
    const firstPath = await schemaFile(schemas, 'first.schema.json', 'https://schemas.example.test/first/v1');
    const extra = join(root, 'extra');
    await mkdir(extra, { recursive: true });
    const secondPath = await schemaFile(extra, 'second.schema.json', 'https://schemas.example.test/second/v1');
    const searches = [
      'https://schemas.example.test/second/v1',
      'https://schemas.example.test/first/v1',
    ];

    const syncResults = resolveRegisteredSchemasSync(searches, {
      configuration,
      schemaRoots: [extra],
    });
    expect(syncResults).toMatchObject([
      { id: searches[0], path: secondPath },
      { id: searches[1], path: firstPath },
    ]);

    await expect(resolveRegisteredSchemas(searches, {
      configuration,
      schemaRoots: [extra],
    })).resolves.toMatchObject([
      { id: searches[0], path: secondPath },
      { id: searches[1], path: firstPath },
    ]);
  });

  it('requires exactly one matching schema', async () => {
    const { configuration, schemas } = await fixture();
    await schemaFile(schemas, 'one.json', 'https://schemas.handschuh.dev/sdlc/task-envelope/v1');
    await schemaFile(schemas, 'two.json', 'https://schemas.example.test/other/task-envelope/v1');

    await expect(resolveRegisteredSchema('task-envelope/v1', { configuration })).rejects.toThrow(
      'matched 2 registered schemas',
    );
    await expect(resolveRegisteredSchema('does-not-exist', { configuration })).rejects.toThrow(
      'No registered schema matches: does-not-exist',
    );
  });

  it('rejects an empty search string', async () => {
    await expect(resolveRegisteredSchema('   ')).rejects.toThrow(SchemaResolutionError);
  });
});