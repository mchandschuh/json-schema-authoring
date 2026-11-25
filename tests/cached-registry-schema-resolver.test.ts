import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { readFileSync, readdirSync, realpathSync } from 'node:fs';
import { realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { SchemaRegistryConfiguration } from '../src/core/schema/registry.js';
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
  readonly readFilePaths?: Map<string, number>;
  readonly readdirPaths?: Map<string, number>;
}

interface ReadGate {
  readonly path: string;
  readonly started: Promise<void>;
  readonly released: Promise<void>;
  signalStarted(): void;
  release(): void;
}

function readGate(path: string): ReadGate {
  let signalStarted!: () => void;
  let release!: () => void;
  const started = new Promise<void>((resolve) => { signalStarted = resolve; });
  const released = new Promise<void>((resolve) => { release = resolve; });
  return { path, started, released, signalStarted, release };
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

function fileSystem(counters: Counters, options: { readonly delayPath?: string; readonly gate?: ReadGate } = {}): CachedRegistrySchemaFileSystem {
  const countPath = (paths: Map<string, number> | undefined, path: string): void => {
    if (paths) paths.set(path, (paths.get(path) ?? 0) + 1);
  };
  return {
    readFileSync: (path) => {
      counters.readFileSync += 1;
      countPath(counters.readFilePaths, path);
      return readFileSync(path, 'utf8');
    },
    readFile: async (path) => {
      counters.readFile += 1;
      countPath(counters.readFilePaths, path);
      if (options.gate?.path === path) {
        options.gate.signalStarted();
        await options.gate.released;
      }
      if (options.delayPath === path) await new Promise((resolve) => setTimeout(resolve, 10));
      return readFile(path, 'utf8');
    },
    readdirSync: (path) => {
      counters.readdirSync += 1;
      countPath(counters.readdirPaths, path);
      return readdirSync(path, { withFileTypes: true });
    },
    readdir: async (path) => {
      counters.readdir += 1;
      countPath(counters.readdirPaths, path);
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

  it('combines resolver roots, context roots, and configured registry roots', async () => {
    const fixtureValue = await fixture();
    const app = join(fixtureValue.root, 'app');
    const home = join(fixtureValue.root, 'home');
    const configuration = new SchemaRegistryConfiguration({ cwd: app, homeDirectory: home, environment: {} });
    await configuration.add(fixtureValue.first, 'home');
    const resolver = new CachedRegistrySchemaResolver({
      schemaRoots: [fixtureValue.second],
      registryConfiguration: configuration,
    });

    await expect(resolver.resolve(fixtureValue.firstId, {
      documentPath: fixtureValue.rootPath,
      schemaRoots: [fixtureValue.first],
    })).resolves.toMatchObject({ path: fixtureValue.firstPath });
    await expect(resolver.resolve(fixtureValue.secondId, {
      documentPath: fixtureValue.rootPath,
    })).resolves.toMatchObject({ path: fixtureValue.secondPath });
  });

  it('keeps caches isolated between custom resolver instances', async () => {
    const fixtureValue = await fixture();
    const firstResolver = new CachedRegistrySchemaResolver({ schemaRoots: [fixtureValue.first] });
    const secondResolver = new CachedRegistrySchemaResolver({ schemaRoots: [fixtureValue.first] });
    const currentContext = context(fixtureValue, [fixtureValue.first]);

    const firstResult = firstResolver.resolveSync(fixtureValue.firstId, currentContext);
    const secondResult = secondResolver.resolveSync(fixtureValue.firstId, currentContext);
    expect(firstResult.schema).not.toBe(secondResult.schema);
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

  it('resolves an absolute ID with a fragment and caches the fragment-free document', async () => {
    const fixtureValue = await fixture();
    const resolver = new CachedRegistrySchemaResolver({ schemaRoots: [fixtureValue.first] });
    const currentContext = context(fixtureValue, [fixtureValue.first]);

    const result = resolver.resolveSync(`${fixtureValue.firstId}#/$defs/value`, currentContext);
    expect(result).toMatchObject({ requestedUri: fixtureValue.firstId, canonicalUri: fixtureValue.firstId, path: fixtureValue.firstPath });
    expect(resolver.resolveSync(fixtureValue.firstId, currentContext).schema).toBe(result.schema);
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

  it('rejects sync root and file-system failures with structured resolver errors', async () => {
    const fixtureValue = await fixture();
    const resolver = new CachedRegistrySchemaResolver({ schemaRoots: [fixtureValue.first] });

    expectResolverError(() => resolver.resolveSync('file:///definitely/missing/schema.json', context(fixtureValue, [fixtureValue.first])), 'SCHEMA_OUTSIDE_ROOT');
    expectResolverError(() => resolver.resolveSync('./missing.schema.json', { documentPath: fixtureValue.firstPath, schemaRoots: [fixtureValue.first] }), 'SCHEMA_FILE_READ');
    expect(() => resolver.resolveSync('not a uri', context(fixtureValue, [fixtureValue.first]))).toThrow(CachedRegistrySchemaResolverError);
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
    expect(counters.readFile).toBe(3);
  });

  it('deduplicates concurrent loads after indexing for an unindexed document', async () => {
    const fixtureValue = await fixture();
    const unindexedPath = join(fixtureValue.first, 'unindexed.json');
    await writeFile(unindexedPath, JSON.stringify({ type: 'string' }), 'utf8');
    const counters: Counters = { readFile: 0, readFileSync: 0, readdir: 0, readdirSync: 0, readFilePaths: new Map() };
    const gate = readGate(unindexedPath);
    const resolver = new CachedRegistrySchemaResolver({ schemaRoots: [fixtureValue.first], fileSystem: fileSystem(counters, { gate }) });
    const requestContext = { documentPath: join(fixtureValue.first, 'requesting.schema.json'), schemaRoots: [fixtureValue.first] };
    const pending = Promise.all(Array.from({ length: 10 }, () => resolver.resolve('./unindexed.json', requestContext)));
    await gate.started;
    gate.release();
    const results = await pending;

    expect(results.every((result) => result.path === unindexedPath)).toBe(true);
    expect(counters.readFilePaths?.get(unindexedPath)).toBe(2);
    expect(new Set(results.map((result) => result.schema)).size).toBe(1);
  });

  it('resolves asynchronous batches across multiple roots in input order', async () => {
    const fixtureValue = await fixture();
    const resolver = new CachedRegistrySchemaResolver({ schemaRoots: [fixtureValue.first, fixtureValue.second] });
    const results = await resolver.resolveMany([fixtureValue.secondId, fixtureValue.firstId], context(fixtureValue));

    expect(results.map((result) => result.path)).toEqual([fixtureValue.secondPath, fixtureValue.firstPath]);
  });

  it('shares one index and one load per resource across concurrent batches', async () => {
    const fixtureValue = await fixture();
    const counters: Counters = { readFile: 0, readFileSync: 0, readdir: 0, readdirSync: 0, readdirPaths: new Map(), readFilePaths: new Map() };
    const resolver = new CachedRegistrySchemaResolver({ schemaRoots: [fixtureValue.first, fixtureValue.second], fileSystem: fileSystem(counters) });
    const currentContext = context(fixtureValue);
    const [firstBatch, secondBatch] = await Promise.all([
      resolver.resolveMany([fixtureValue.firstId, fixtureValue.secondId], currentContext),
      resolver.resolveMany([fixtureValue.secondId, fixtureValue.firstId], currentContext),
    ]);

    expect(firstBatch.map((result) => result.path)).toEqual([fixtureValue.firstPath, fixtureValue.secondPath]);
    expect(secondBatch.map((result) => result.path)).toEqual([fixtureValue.secondPath, fixtureValue.firstPath]);
    expect(counters.readdirPaths?.get(fixtureValue.documents)).toBe(1);
    expect(counters.readdirPaths?.get(fixtureValue.first)).toBe(1);
    expect(counters.readdirPaths?.get(fixtureValue.second)).toBe(1);
  });

  it('preserves independent document contexts during concurrent relative lookups', async () => {
    const fixtureValue = await fixture();
    const firstDocuments = join(fixtureValue.root, 'context-one');
    const secondDocuments = join(fixtureValue.root, 'context-two');
    await Promise.all([mkdir(firstDocuments), mkdir(secondDocuments)]);
    const firstPath = join(firstDocuments, 'shared.json');
    const secondPath = join(secondDocuments, 'shared.json');
    await Promise.all([
      writeFile(firstPath, JSON.stringify({ value: 'one' }), 'utf8'),
      writeFile(secondPath, JSON.stringify({ value: 'two' }), 'utf8'),
    ]);
    const resolver = new CachedRegistrySchemaResolver();

    const [firstResult, secondResult] = await Promise.all([
      resolver.resolve('./shared.json', { documentPath: join(firstDocuments, 'root.json') }),
      resolver.resolve('./shared.json', { documentPath: join(secondDocuments, 'root.json') }),
    ]);

    expect(firstResult).toMatchObject({ path: firstPath, schema: { value: 'one' } });
    expect(secondResult).toMatchObject({ path: secondPath, schema: { value: 'two' } });
  });

  it('shares concurrent failures and permits retry after a missing file is created', async () => {
    const fixtureValue = await fixture();
    const missingPath = join(fixtureValue.first, 'concurrent-missing.json');
    const counters: Counters = { readFile: 0, readFileSync: 0, readdir: 0, readdirSync: 0, readFilePaths: new Map() };
    const resolver = new CachedRegistrySchemaResolver({ schemaRoots: [fixtureValue.first], fileSystem: fileSystem(counters) });
    const requestContext = { documentPath: join(fixtureValue.first, 'requesting.schema.json'), schemaRoots: [fixtureValue.first] };
    const uri = pathToFileURL(missingPath).href;
    const failures = await Promise.allSettled(Array.from({ length: 8 }, () => resolver.resolve(uri, requestContext)));

    expect(failures.every((result) => result.status === 'rejected')).toBe(true);
    expect(counters.readFilePaths?.get(missingPath)).toBe(1);
    await writeFile(missingPath, JSON.stringify({ type: 'boolean' }), 'utf8');
    await expect(resolver.resolve(uri, requestContext)).resolves.toMatchObject({ path: missingPath, schema: { type: 'boolean' } });
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

  it('registers cyclic and dynamic external dependencies without looping', async () => {
    const fixtureValue = await fixture();
    const cycleA = 'https://schemas.example.test/cycle/a';
    const cycleB = 'https://schemas.example.test/cycle/b';
    await writeFile(join(fixtureValue.first, 'cycle-a.json'), JSON.stringify({ $id: cycleA, $ref: cycleB }), 'utf8');
    await writeFile(join(fixtureValue.first, 'cycle-b.json'), JSON.stringify({ $id: cycleB, $dynamicAnchor: 'value', $dynamicRef: cycleA }), 'utf8');
    const rootSchema = { $id: 'https://schemas.example.test/cycle/root', $ref: cycleA };
    const resolver = new CachedRegistrySchemaResolver({ schemaRoots: [fixtureValue.first] });
    const ajv = new Ajv2020({ strict: false });

    expect(() => resolver.registerSync(ajv, { documentPath: fixtureValue.rootPath, rootSchema, schemaRoots: [fixtureValue.first] })).not.toThrow();
  });

  it('maps Ajv registration failures to AJV_REGISTRATION', async () => {
    const fixtureValue = await fixture();
    const resolver = new CachedRegistrySchemaResolver({ schemaRoots: [fixtureValue.first] });
    const rootSchema = { $id: 'https://schemas.example.test/root/v1', $ref: fixtureValue.firstId };
    const ajv = {
      addSchema: () => { throw new Error('registration failed'); },
      getSchema: () => undefined,
    };

    expectResolverError(() => resolver.registerSync(ajv, { documentPath: fixtureValue.rootPath, rootSchema, schemaRoots: [fixtureValue.first] }), 'AJV_REGISTRATION');
  });

  it('supports concurrent registration on one and separate Ajv instances', async () => {
    const fixtureValue = await fixture();
    const resolver = new CachedRegistrySchemaResolver({ schemaRoots: [fixtureValue.first] });
    const rootSchema = { $id: 'https://schemas.example.test/root/v1', type: 'object', properties: { child: { $ref: fixtureValue.firstId } } };
    const rootContext = { documentPath: fixtureValue.rootPath, rootSchema, schemaRoots: [fixtureValue.first] };
    const sharedAjv = new Ajv2020({ strict: false });
    await expect(Promise.all([resolver.register(sharedAjv, rootContext), resolver.register(sharedAjv, rootContext)])).resolves.toBeDefined();
    const [firstAjv, secondAjv] = [new Ajv2020({ strict: false }), new Ajv2020({ strict: false })];
    await expect(Promise.all([resolver.register(firstAjv, rootContext), resolver.register(secondAjv, rootContext)])).resolves.toBeDefined();
  });

  it('works as Ajv compileAsync loadSchema callback', async () => {
    const fixtureValue = await fixture();
    const resolver = new CachedRegistrySchemaResolver({ schemaRoots: [fixtureValue.first] });
    const rootSchema = {
      $id: 'https://schemas.example.test/async-root/v1',
      type: 'object',
      properties: { value: { $ref: fixtureValue.firstId } },
    };
    const contextValue = { documentPath: fixtureValue.rootPath, rootSchema, schemaRoots: [fixtureValue.first] };
    const ajv = new Ajv2020({ strict: false, loadSchema: resolver.createLoadSchema(contextValue) });
    const validate = await ajv.compileAsync(rootSchema);

    expect(validate({ value: 'valid' })).toBe(true);
    expect(validate({ value: 42 })).toBe(false);
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

  it('invalidates by path and file URI while leaving unrelated cached schemas intact', async () => {
    const fixtureValue = await fixture();
    const counters: Counters = { readFile: 0, readFileSync: 0, readdir: 0, readdirSync: 0, readFilePaths: new Map() };
    const resolver = new CachedRegistrySchemaResolver({ schemaRoots: [fixtureValue.first, fixtureValue.second], fileSystem: fileSystem(counters) });
    const currentContext = context(fixtureValue);
    resolver.resolveSync(fixtureValue.firstId, currentContext);
    resolver.resolveSync(fixtureValue.secondId, currentContext);
    const firstReads = counters.readFilePaths?.get(fixtureValue.firstPath) ?? 0;
    const secondReads = counters.readFilePaths?.get(fixtureValue.secondPath) ?? 0;

    resolver.invalidate(pathToFileURL(fixtureValue.firstPath).href);
    resolver.resolveSync(fixtureValue.firstId, currentContext);
    resolver.resolveSync(fixtureValue.secondId, currentContext);

    expect(counters.readFilePaths?.get(fixtureValue.firstPath)).toBeGreaterThan(firstReads);
    expect(counters.readFilePaths?.get(fixtureValue.secondPath)).toBe(secondReads);
    resolver.invalidate('');
    resolver.invalidate('/unknown/schema.json');
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