import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { readFileSync, readdirSync, realpathSync } from 'node:fs';
import { realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import {
  CachedRegistrySchemaResolver,
  CachedRegistrySchemaResolverError,
  createCachedRegistrySchemaResolver,
  getDefaultCachedRegistrySchemaResolver,
  type CachedRegistrySchemaFileSystem,
} from '../src/core/schema/cached-registry-schema-resolver.js';

const dialect = 'https://json-schema.org/draft/2020-12/schema';

interface Fixture {
  readonly root: string;
  readonly documents: string;
  readonly first: string;
  readonly second: string;
  readonly rootPath: string;
  readonly firstPath: string;
  readonly secondPath: string;
  readonly firstId: string;
  readonly secondId: string;
}

interface Counters {
  readFile: number;
  readFileSync: number;
  readdir: number;
  readdirSync: number;
}

async function fixture(): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), 'cached-registry-resolver-'));
  const documents = join(root, 'documents');
  const first = join(root, 'first');
  const second = join(root, 'second');
  await Promise.all([mkdir(documents, { recursive: true }), mkdir(first, { recursive: true }), mkdir(second, { recursive: true })]);

  const firstId = 'https://schemas.example.test/first/v1';
  const secondId = 'https://schemas.example.test/second/v1';
  const firstPath = join(first, 'first.schema.json');
  const secondPath = join(second, 'second.schema.json');
  const rootPath = join(documents, 'root.schema.json');
  await Promise.all([
    writeFile(firstPath, JSON.stringify({ $schema: dialect, $id: firstId, type: 'string', minLength: 1 }), 'utf8'),
    writeFile(secondPath, JSON.stringify({ $schema: dialect, $id: secondId, type: 'number', minimum: 1 }), 'utf8'),
    writeFile(rootPath, JSON.stringify({ $schema: dialect, $id: 'https://schemas.example.test/root/v1', type: 'object' }), 'utf8'),
  ]);
  return { root, documents, first, second, rootPath, firstPath, secondPath, firstId, secondId };
}

function fileSystem(counters: Counters, options: { readonly delayPath?: string } = {}): CachedRegistrySchemaFileSystem {
  return {
    readFileSync: (path) => {
      counters.readFileSync += 1;
      return readFileSync(path, 'utf8');
    },
    readFile: async (path) => {
      counters.readFile += 1;
      if (options.delayPath === path) await new Promise((resolve) => setTimeout(resolve, 10));
      return readFile(path, 'utf8');
    },
    readdirSync: (path) => {
      counters.readdirSync += 1;
      return readdirSync(path, { withFileTypes: true });
    },
    readdir: async (path) => {
      counters.readdir += 1;
      return readdir(path, { withFileTypes: true });
    },
    realpathSync,
    realpath,
  };
}

function context(fixtureValue: Fixture, schemaRoots: readonly string[] = [fixtureValue.first, fixtureValue.second]) {
  return { documentPath: fixtureValue.rootPath, schemaRoots };
}

function expectResolverError(action: () => unknown, code: CachedRegistrySchemaResolverError['prototype']['code']) {
  expect(() => action()).toThrow(expect.objectContaining({ code }));
}

describe('CachedRegistrySchemaResolver', () => {
  it('creates isolated custom instances and exposes a process-local default instance', () => {
    expect(createCachedRegistrySchemaResolver()).not.toBe(createCachedRegistrySchemaResolver());
    expect(getDefaultCachedRegistrySchemaResolver()).toBe(getDefaultCachedRegistrySchemaResolver());
  });

  it('resolves relative, file, and registered absolute references synchronously', async () => {
    const fixtureValue = await fixture();
    const resolver = new CachedRegistrySchemaResolver({ schemaRoots: [fixtureValue.first, fixtureValue.second] });
    const currentContext = context(fixtureValue);

    expect(resolver.resolveSync(fixtureValue.firstId, currentContext)).toMatchObject({ canonicalUri: fixtureValue.firstId, path: fixtureValue.firstPath });
    expect(resolver.resolveSync(pathToFileURL(fixtureValue.secondPath).href, currentContext)).toMatchObject({ path: fixtureValue.secondPath });

    const relative = resolver.resolveSync('../first/first.schema.json', currentContext);
    expect(relative).toMatchObject({ path: fixtureValue.firstPath, canonicalUri: fixtureValue.firstId });
  });

  it('resolves an in-memory root schema without reading the root file', async () => {
    const fixtureValue = await fixture();
    const counters: Counters = { readFile: 0, readFileSync: 0, readdir: 0, readdirSync: 0 };
    const resolver = new CachedRegistrySchemaResolver({ schemaRoots: [fixtureValue.first], fileSystem: fileSystem(counters) });
    const rootSchema = { $id: 'https://schemas.example.test/memory/v1', type: 'string' };

    const result = resolver.resolveSync(rootSchema.$id, {
      documentPath: fixtureValue.rootPath,
      rootSchema,
      schemaRoots: [fixtureValue.first],
    });

    expect(result.schema).toBe(rootSchema);
    expect(counters.readFileSync).toBe(0);
  });

  it('resolves fragment-only references against the in-memory root schema', async () => {
    const fixtureValue = await fixture();
    const resolver = new CachedRegistrySchemaResolver({ schemaRoots: [fixtureValue.first] });
    const rootSchema = { $id: 'https://schemas.example.test/memory/v1', $defs: { value: { type: 'string' } } };

    await expect(resolver.resolve('#/$defs/value', {
      documentPath: fixtureValue.rootPath,
      rootSchema,
      schemaRoots: [fixtureValue.first],
    })).resolves.toMatchObject({ schema: rootSchema, path: fixtureValue.rootPath });
  });

  it('resolves multiple roots synchronously in batch order and preserves duplicate inputs', async () => {
    const fixtureValue = await fixture();
    const resolver = new CachedRegistrySchemaResolver({ schemaRoots: [fixtureValue.first, fixtureValue.second] });

    const results = resolver.resolveManySync([
      fixtureValue.secondId,
      fixtureValue.firstId,
      fixtureValue.secondId,
    ], context(fixtureValue));

    expect(results.map((result) => result.path)).toEqual([
      fixtureValue.secondPath,
      fixtureValue.firstPath,
      fixtureValue.secondPath,
    ]);
    expect(results[0]?.schema).toBe(results[2]?.schema);
  });

  it('returns an empty synchronous batch without scanning roots', async () => {
    const fixtureValue = await fixture();
    const counters: Counters = { readFile: 0, readFileSync: 0, readdir: 0, readdirSync: 0 };
    const resolver = new CachedRegistrySchemaResolver({ fileSystem: fileSystem(counters) });

    expect(resolver.resolveManySync([], context(fixtureValue))).toEqual([]);
    expect(counters.readdirSync).toBe(0);
  });

  it.each([
    ['', 'EMPTY_URI'],
    ['ftp://schemas.example.test/schema.json', 'UNSUPPORTED_PROTOCOL'],
    ['https://schemas.example.test/missing/v1', 'SCHEMA_NOT_FOUND'],
    ['../outside.schema.json', 'SCHEMA_OUTSIDE_ROOT'],
  ] as const)('rejects %s synchronously with %s', async (uri, code) => {
    const fixtureValue = await fixture();
    const resolver = new CachedRegistrySchemaResolver({ schemaRoots: [fixtureValue.first] });
    expectResolverError(() => resolver.resolveSync(uri, context(fixtureValue, [fixtureValue.first])), code);
  });

  it('rejects malformed JSON, non-object schemas, and duplicate IDs synchronously', async () => {
    const fixtureValue = await fixture();
    const malformedPath = join(fixtureValue.first, 'malformed.json');
    const arrayPath = join(fixtureValue.first, 'array.json');
    await writeFile(malformedPath, '{"type":', 'utf8');
    await writeFile(arrayPath, '[]', 'utf8');
    const malformed = new CachedRegistrySchemaResolver({ schemaRoots: [fixtureValue.first] });
    expectResolverError(() => malformed.resolveSync(pathToFileURL(malformedPath).href, context(fixtureValue, [fixtureValue.first])), 'SCHEMA_INVALID_JSON');
    expectResolverError(() => malformed.resolveSync(pathToFileURL(arrayPath).href, context(fixtureValue, [fixtureValue.first])), 'SCHEMA_NOT_OBJECT');

    await writeFile(join(fixtureValue.second, 'duplicate.schema.json'), JSON.stringify({ $id: fixtureValue.firstId, type: 'string' }), 'utf8');
    const duplicate = new CachedRegistrySchemaResolver({ schemaRoots: [fixtureValue.first, fixtureValue.second] });
    expectResolverError(() => duplicate.resolveSync(fixtureValue.firstId, context(fixtureValue)), 'DUPLICATE_SCHEMA_ID');
  });

  it('resolves asynchronously and shares one in-flight index and document load', async () => {
    const fixtureValue = await fixture();
    const counters: Counters = { readFile: 0, readFileSync: 0, readdir: 0, readdirSync: 0 };
    const resolver = new CachedRegistrySchemaResolver({
      schemaRoots: [fixtureValue.first, fixtureValue.second],
      fileSystem: fileSystem(counters, { delayPath: fixtureValue.firstPath }),
    });

    const results = await Promise.all(Array.from({ length: 10 }, () => resolver.resolve(fixtureValue.firstId, context(fixtureValue))));

    expect(results.every((result) => result.path === fixtureValue.firstPath)).toBe(true);
    expect(new Set(results.map((result) => result.schema)).size).toBe(1);
    expect(counters.readdir).toBe(3);
    expect(counters.readFile).toBe(2);
  });

  it('resolves asynchronous batches across multiple roots in input order', async () => {
    const fixtureValue = await fixture();
    const resolver = new CachedRegistrySchemaResolver({ schemaRoots: [fixtureValue.first, fixtureValue.second] });
    const results = await resolver.resolveMany([fixtureValue.secondId, fixtureValue.firstId], context(fixtureValue));

    expect(results.map((result) => result.path)).toEqual([fixtureValue.secondPath, fixtureValue.firstPath]);
  });

  it('rejects an invalid item in an asynchronous batch without caching a failed result', async () => {
    const fixtureValue = await fixture();
    const resolver = new CachedRegistrySchemaResolver({ schemaRoots: [fixtureValue.first] });

    await expect(resolver.resolveMany([fixtureValue.firstId, 'https://schemas.example.test/missing/v1'], context(fixtureValue, [fixtureValue.first])))
      .rejects.toMatchObject({ code: 'SCHEMA_NOT_FOUND' });
    await expect(resolver.resolve(fixtureValue.firstId, context(fixtureValue, [fixtureValue.first])))
      .resolves.toMatchObject({ path: fixtureValue.firstPath });
  });

  it('does not permanently cache failed async loads and succeeds after the file is fixed', async () => {
    const fixtureValue = await fixture();
    const missingPath = join(fixtureValue.first, 'later.schema.json');
    const resolver = new CachedRegistrySchemaResolver({ schemaRoots: [fixtureValue.first] });
    const uri = pathToFileURL(missingPath).href;

    await expect(resolver.resolve(uri, context(fixtureValue, [fixtureValue.first]))).rejects.toMatchObject({ code: 'SCHEMA_FILE_READ' });
    await writeFile(missingPath, JSON.stringify({ $id: 'https://schemas.example.test/later/v1', type: 'boolean' }), 'utf8');
    await expect(resolver.resolve(uri, context(fixtureValue, [fixtureValue.first]))).resolves.toMatchObject({ path: missingPath });
  });

  it('registers recursive external dependencies synchronously and asynchronously with Ajv', async () => {
    const fixtureValue = await fixture();
    const grandchildId = 'https://schemas.example.test/grandchild/v1';
    await writeFile(join(fixtureValue.first, 'grandchild.schema.json'), JSON.stringify({ $id: grandchildId, type: 'string', minLength: 1 }), 'utf8');
    await writeFile(fixtureValue.firstPath, JSON.stringify({
      $id: fixtureValue.firstId,
      type: 'object',
      properties: { value: { $ref: grandchildId } },
      required: ['value'],
      additionalProperties: false,
    }), 'utf8');
    const rootSchema = {
      $id: 'https://schemas.example.test/root/v1',
      type: 'object',
      properties: { child: { $ref: fixtureValue.firstId } },
      required: ['child'],
      additionalProperties: false,
    };
    const rootContext = { documentPath: fixtureValue.rootPath, rootSchema, schemaRoots: [fixtureValue.first] };

    const syncAjv = new Ajv2020({ strict: false });
    const resolver = new CachedRegistrySchemaResolver({ schemaRoots: [fixtureValue.first] });
    resolver.registerSync(syncAjv, rootContext);
    expect(syncAjv.compile(rootSchema)({ child: { value: 'ok' } })).toBe(true);
    expect(syncAjv.compile(rootSchema)({ child: { value: '' } })).toBe(false);

    const asyncAjv = new Ajv2020({ strict: false });
    await resolver.register(asyncAjv, rootContext);
    expect(asyncAjv.compile(rootSchema)({ child: { value: 'ok' } })).toBe(true);
  });

  it('rejects synchronous and asynchronous registration for an unavailable dependency', async () => {
    const fixtureValue = await fixture();
    const rootSchema = {
      $id: 'https://schemas.example.test/root/v1',
      type: 'object',
      properties: { child: { $ref: 'https://schemas.example.test/missing/v1' } },
    };
    const rootContext = { documentPath: fixtureValue.rootPath, rootSchema, schemaRoots: [fixtureValue.first] };
    const resolver = new CachedRegistrySchemaResolver({ schemaRoots: [fixtureValue.first] });

    expectResolverError(() => resolver.registerSync(new Ajv2020({ strict: false }), rootContext), 'SCHEMA_NOT_FOUND');
    await expect(resolver.register(new Ajv2020({ strict: false }), rootContext)).rejects.toMatchObject({ code: 'SCHEMA_NOT_FOUND' });
  });

  it('creates an Ajv loadSchema callback with an isolated context', async () => {
    const fixtureValue = await fixture();
    const resolver = new CachedRegistrySchemaResolver({ schemaRoots: [fixtureValue.first] });
    const loadSchema = resolver.createLoadSchema(context(fixtureValue, [fixtureValue.first]));

    await expect(loadSchema(fixtureValue.firstId)).resolves.toMatchObject({ $id: fixtureValue.firstId });
    await expect(loadSchema('https://schemas.example.test/missing/v1')).rejects.toMatchObject({ code: 'SCHEMA_NOT_FOUND' });
  });

  it('invalidates by ID and clearCache forces subsequent filesystem work', async () => {
    const fixtureValue = await fixture();
    const counters: Counters = { readFile: 0, readFileSync: 0, readdir: 0, readdirSync: 0 };
    const resolver = new CachedRegistrySchemaResolver({ schemaRoots: [fixtureValue.first], fileSystem: fileSystem(counters) });
    const currentContext = context(fixtureValue, [fixtureValue.first]);

    resolver.resolveSync(fixtureValue.firstId, currentContext);
    const afterFirst = counters.readFileSync;
    resolver.resolveSync(fixtureValue.firstId, currentContext);
    expect(counters.readFileSync).toBe(afterFirst);

    resolver.invalidate(fixtureValue.firstId);
    resolver.resolveSync(fixtureValue.firstId, currentContext);
    expect(counters.readFileSync).toBeGreaterThan(afterFirst);

    resolver.clearCache();
    const beforeClearReload = counters.readFileSync;
    resolver.resolveSync(fixtureValue.firstId, currentContext);
    expect(counters.readFileSync).toBeGreaterThan(beforeClearReload);
  });

  it('does not repopulate stale async data after clearCache', async () => {
    const fixtureValue = await fixture();
    const counters: Counters = { readFile: 0, readFileSync: 0, readdir: 0, readdirSync: 0 };
    const resolver = new CachedRegistrySchemaResolver({
      schemaRoots: [fixtureValue.first],
      fileSystem: fileSystem(counters, { delayPath: fixtureValue.firstPath }),
    });
    const pending = resolver.resolve(fixtureValue.firstId, context(fixtureValue, [fixtureValue.first]));
    await new Promise((resolve) => setTimeout(resolve, 0));
    resolver.clearCache();
    await pending;
    await expect(resolver.resolve(fixtureValue.firstId, context(fixtureValue, [fixtureValue.first]))).resolves.toMatchObject({ path: fixtureValue.firstPath });
    expect(counters.readFile).toBeGreaterThan(1);
  });
});