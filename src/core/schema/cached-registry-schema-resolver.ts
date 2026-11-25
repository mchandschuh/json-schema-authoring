import {
  readFileSync,
  readdirSync,
  realpathSync,
} from 'node:fs';
import { readFile, readdir, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve as resolvePath, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SchemaRegistryConfiguration } from './registry.js';
import type { SchemaResolution, SchemaResolver, SchemaResolverAjv, SchemaResolverContext } from './resolver-contract.js';
import { isSchemaObject } from './types.js';

const DIALECT = 'https://json-schema.org/draft/2020-12/schema';

export type CachedRegistrySchemaResolverErrorCode =
  | 'EMPTY_URI'
  | 'INVALID_URI'
  | 'UNSUPPORTED_PROTOCOL'
  | 'SCHEMA_NOT_FOUND'
  | 'SCHEMA_OUTSIDE_ROOT'
  | 'SCHEMA_FILE_READ'
  | 'SCHEMA_INVALID_JSON'
  | 'SCHEMA_NOT_OBJECT'
  | 'DUPLICATE_SCHEMA_ID'
  | 'AJV_REGISTRATION';

export class CachedRegistrySchemaResolverError extends Error {
  readonly code: CachedRegistrySchemaResolverErrorCode;
  readonly uri?: string;
  readonly path?: string;

  constructor(code: CachedRegistrySchemaResolverErrorCode, message: string, options: { readonly uri?: string; readonly path?: string } = {}) {
    super(message);
    this.name = 'CachedRegistrySchemaResolverError';
    this.code = code;
    this.uri = options.uri;
    this.path = options.path;
  }
}

export interface CachedRegistrySchemaDirectoryEntry {
  readonly name: string;
  isDirectory(): boolean;
  isFile(): boolean;
}

export interface CachedRegistrySchemaFileSystem {
  readFileSync(path: string): string;
  readFile(path: string): Promise<string>;
  readdirSync(path: string): readonly CachedRegistrySchemaDirectoryEntry[];
  readdir(path: string): Promise<readonly CachedRegistrySchemaDirectoryEntry[]>;
  realpathSync(path: string): string;
  realpath(path: string): Promise<string>;
}

export interface CachedRegistrySchemaResolverOptions {
  readonly schemaRoots?: readonly string[];
  readonly registryConfiguration?: SchemaRegistryConfiguration;
  readonly fileSystem?: CachedRegistrySchemaFileSystem;
}

export type CachedRegistrySchemaResolutionContext = SchemaResolverContext;

export type CachedRegistrySchemaResolution = SchemaResolution;

export type CachedRegistrySchemaAjv = SchemaResolverAjv;

interface CachedSchema extends CachedRegistrySchemaResolution {
  readonly generation: number;
}

interface RootIndex {
  readonly scopeKey: string;
  readonly roots: readonly string[];
  readonly byId: ReadonlyMap<string, string>;
  readonly byPath: ReadonlyMap<string, Record<string, unknown>>;
}

interface ResolverFileSystem {
  readFileSync(path: string): string;
  readFile(path: string): Promise<string>;
  readdirSync(path: string): readonly CachedRegistrySchemaDirectoryEntry[];
  readdir(path: string): Promise<readonly CachedRegistrySchemaDirectoryEntry[]>;
  realpathSync(path: string): string;
  realpath(path: string): Promise<string>;
}

interface ResolutionSession {
  readonly context: CachedRegistrySchemaResolutionContext;
  readonly documentDirectory: string;
  readonly roots: readonly string[];
  readonly scope: string;
}

const defaultFileSystem: ResolverFileSystem = {
  readFileSync: (path) => readFileSync(path, 'utf8'),
  readFile: (path) => readFile(path, 'utf8'),
  readdirSync: (path) => readdirSync(path, { withFileTypes: true }),
  readdir: (path) => readdir(path, { withFileTypes: true }),
  realpathSync,
  realpath,
};

function withoutFragment(uri: string): string {
  const fragmentIndex = uri.indexOf('#');
  return fragmentIndex < 0 ? uri : uri.slice(0, fragmentIndex);
}

function decodePath(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

function isInside(rootDirectory: string, candidate: string): boolean {
  const path = relative(rootDirectory, candidate);
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !path.startsWith(sep));
}

function isAbsoluteUri(value: string): boolean {
  return /^[A-Za-z][A-Za-z0-9+.-]*:/.test(value);
}

function schemaId(schema: Record<string, unknown>): string | undefined {
  return typeof schema.$id === 'string' && schema.$id.trim().length > 0
    ? withoutFragment(schema.$id)
    : undefined;
}

function normalizedUri(uri: string): string {
  const value = uri.trim();
  if (!value) throw new CachedRegistrySchemaResolverError('EMPTY_URI', 'A schema URI is required.');
  return withoutFragment(value);
}

function scopeKey(roots: readonly string[]): string {
  return roots.join('\u0000');
}

function cacheKey(scope: string, uri: string): string {
  return `${scope}\u0000${uri}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function rootSchemaId(schema: unknown): string | undefined {
  return isSchemaObject(schema) && typeof schema.$id === 'string'
    ? withoutFragment(schema.$id)
    : undefined;
}

function externalReferences(schema: Record<string, unknown>): readonly string[] {
  const references = new Set<string>();
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (typeof value !== 'object' || value === null) return;
    for (const [key, child] of Object.entries(value)) {
      if ((key === '$ref' || key === '$dynamicRef') && typeof child === 'string' && !child.startsWith('#')) references.add(child);
      else visit(child);
    }
  };
  visit(schema);
  return [...references];
}

function defaultContext(context: CachedRegistrySchemaResolutionContext): CachedRegistrySchemaResolutionContext {
  return { ...context, documentPath: resolvePath(context.documentPath) };
}

function unique(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}

export class CachedRegistrySchemaResolver implements SchemaResolver {
  readonly #options: CachedRegistrySchemaResolverOptions;
  readonly #fileSystem: ResolverFileSystem;
  readonly #documentCache = new Map<string, CachedSchema>();
  readonly #uriCache = new Map<string, CachedSchema>();
  readonly #indexes = new Map<string, RootIndex>();
  readonly #indexPromises = new Map<string, Promise<RootIndex>>();
  readonly #loadPromises = new Map<string, Promise<CachedSchema>>();
  readonly #ajvRegistrations = new WeakMap<object, Set<string>>();
  #generation = 0;

  constructor(options: CachedRegistrySchemaResolverOptions = {}) {
    this.#options = options;
    this.#fileSystem = options.fileSystem ?? defaultFileSystem;
  }

  resolveSync(uri: string, context: CachedRegistrySchemaResolutionContext): CachedRegistrySchemaResolution {
    const session = this.#session(context);
    const value = uri.trim();
    if (!value) throw new CachedRegistrySchemaResolverError('EMPTY_URI', 'A schema URI is required.');
    const root = this.#rootResolution(value, session);
    if (root && value.startsWith('#')) return this.#requested(root, value);
    const resource = normalizedUri(value);
    const cached = this.#cached(session.scope, resource);
    if (cached) return this.#requested(cached, uri);

    if (root) return this.#requested(root, uri);

    const index = this.#ensureIndexSync(session);
    const indexedPath = index.byId.get(resource);
    if (indexedPath) {
      const resolution = this.#loadPathSync(indexedPath, resource, session);
      this.#rememberReferenceAlias(resource, resolution, session);
      return this.#requested(resolution, uri);
    }

    const path = this.#pathFor(resource, session);
    const resolution = this.#loadPathSync(path, resource, session);
    this.#rememberReferenceAlias(resource, resolution, session);
    return this.#requested(resolution, uri);
  }

  async resolve(uri: string, context: CachedRegistrySchemaResolutionContext): Promise<CachedRegistrySchemaResolution> {
    const session = await this.#asyncSession(context);
    const value = uri.trim();
    if (!value) throw new CachedRegistrySchemaResolverError('EMPTY_URI', 'A schema URI is required.');
    const root = this.#rootResolution(value, session);
    if (root && value.startsWith('#')) return this.#requested(root, value);
    const resource = normalizedUri(value);
    const cached = this.#cached(session.scope, resource);
    if (cached) return this.#requested(cached, uri);

    if (root) return this.#requested(root, uri);

    const index = await this.#ensureIndex(session);
    const indexedPath = index.byId.get(resource);
    const path = indexedPath ?? this.#pathFor(resource, session);
    const loadKey = cacheKey(session.scope, indexedPath ? resource : path);
    const inFlight = this.#loadPromises.get(loadKey);
    if (inFlight) {
      const resolution = await inFlight;
      this.#rememberReferenceAlias(resource, resolution, session);
      return this.#requested(resolution, uri);
    }

    const generation = this.#generation;
    const promise = this.#loadPath(path, resource, session, generation);
    this.#loadPromises.set(loadKey, promise);
    try {
      const resolution = await promise;
      this.#rememberReferenceAlias(resource, resolution, session);
      return this.#requested(resolution, uri);
    } finally {
      if (this.#loadPromises.get(loadKey) === promise) this.#loadPromises.delete(loadKey);
    }
  }

  resolveManySync(uris: readonly string[], context: CachedRegistrySchemaResolutionContext): readonly CachedRegistrySchemaResolution[] {
    if (uris.length === 0) return [];
    const session = this.#session(context);
    this.#ensureIndexSync(session);
    return uris.map((uri) => this.resolveSync(uri, context));
  }

  async resolveMany(uris: readonly string[], context: CachedRegistrySchemaResolutionContext): Promise<readonly CachedRegistrySchemaResolution[]> {
    if (uris.length === 0) return [];
    const session = await this.#asyncSession(context);
    await this.#ensureIndex(session);
    return Promise.all(uris.map((uri) => this.resolve(uri, context)));
  }

  registerSync(ajv: CachedRegistrySchemaAjv, context: CachedRegistrySchemaResolutionContext): void {
    const registered = this.#registrationSet(ajv);
    const root = this.#rootSchemaResolution(context);
    if (!root) return;
    const visited = new Set<string>();
    const queue: Array<{ readonly resolution: CachedRegistrySchemaResolution; readonly schema: Record<string, unknown> }> = [];
    const enqueue = (resolution: CachedRegistrySchemaResolution): void => {
      const key = resolvePath(resolution.path);
      if (visited.has(key)) return;
      visited.add(key);
      queue.push({ resolution, schema: resolution.schema });
    };

    for (const reference of externalReferences(root.schema)) enqueue(this.resolveSync(reference, context));
    while (queue.length > 0) {
      const current = queue.shift()!;
      this.#registerSchemaSync(ajv, registered, current.resolution);
      const childContext = { ...context, documentPath: current.resolution.path, rootSchema: current.schema };
      for (const reference of externalReferences(current.schema)) enqueue(this.resolveSync(reference, childContext));
    }
  }

  async register(ajv: CachedRegistrySchemaAjv, context: CachedRegistrySchemaResolutionContext): Promise<void> {
    const registered = this.#registrationSet(ajv);
    const root = this.#rootSchemaResolution(context);
    if (!root) return;
    const visited = new Set<string>();
    const queue: Array<{ readonly resolution: CachedRegistrySchemaResolution; readonly schema: Record<string, unknown> }> = [];
    const enqueue = (resolution: CachedRegistrySchemaResolution): void => {
      const key = resolvePath(resolution.path);
      if (visited.has(key)) return;
      visited.add(key);
      queue.push({ resolution, schema: resolution.schema });
    };

    for (const reference of externalReferences(root.schema)) enqueue(await this.resolve(reference, context));
    while (queue.length > 0) {
      const current = queue.shift()!;
      this.#registerSchema(ajv, registered, current.resolution);
      const childContext = { ...context, documentPath: current.resolution.path, rootSchema: current.schema };
      for (const reference of externalReferences(current.schema)) enqueue(await this.resolve(reference, childContext));
    }
  }

  createLoadSchema(context: CachedRegistrySchemaResolutionContext): (uri: string) => Promise<Record<string, unknown>> {
    const capturedContext = defaultContext(context);
    return async (uri: string) => (await this.resolve(uri, capturedContext)).schema;
  }

  clearCache(): void {
    this.#generation += 1;
    this.#documentCache.clear();
    this.#uriCache.clear();
    this.#indexes.clear();
    this.#indexPromises.clear();
    this.#loadPromises.clear();
  }

  invalidate(uriOrPath: string): void {
    const value = uriOrPath.trim();
    if (!value) return;
    this.#generation += 1;
    const path = this.#pathFromValue(value);
    const cachedEntries = new Set<CachedSchema>();
    const cached = this.#documentCache.get(path);
    if (cached) cachedEntries.add(cached);
    for (const [key, entry] of this.#uriCache) {
      if (entry.path === path || entry.canonicalUri === withoutFragment(value) || key.endsWith(`\u0000${withoutFragment(value)}`)) cachedEntries.add(entry);
    }
    for (const entry of cachedEntries) this.#removeCached(entry);
    this.#indexPromises.clear();
  }

  #session(context: CachedRegistrySchemaResolutionContext): ResolutionSession {
    const normalizedContext = defaultContext(context);
    const documentDirectory = dirname(normalizedContext.documentPath);
    let configured: readonly { readonly directory: string }[] = [];
    try {
      configured = this.#options.registryConfiguration?.listSync('all') ?? [];
    } catch (error) {
      throw new CachedRegistrySchemaResolverError('SCHEMA_FILE_READ', `Cannot read schema registry configuration: ${errorMessage(error)}`);
    }
    const roots = unique([
      documentDirectory,
      ...(this.#options.schemaRoots ?? []),
      ...(normalizedContext.schemaRoots ?? []),
      ...configured.map((entry) => entry.directory),
    ].map((root) => resolvePath(root)));
    return { context: normalizedContext, documentDirectory, roots, scope: scopeKey(roots) };
  }

  async #asyncSession(context: CachedRegistrySchemaResolutionContext): Promise<ResolutionSession> {
    const normalizedContext = defaultContext(context);
    const documentDirectory = dirname(normalizedContext.documentPath);
    let configured: readonly { readonly directory: string }[] = [];
    try {
      configured = await (this.#options.registryConfiguration?.list('all') ?? Promise.resolve([]));
    } catch (error) {
      throw new CachedRegistrySchemaResolverError('SCHEMA_FILE_READ', `Cannot read schema registry configuration: ${errorMessage(error)}`);
    }
    const roots = unique([
      documentDirectory,
      ...(this.#options.schemaRoots ?? []),
      ...(normalizedContext.schemaRoots ?? []),
      ...configured.map((entry) => entry.directory),
    ].map((root) => resolvePath(root)));
    return { context: normalizedContext, documentDirectory, roots, scope: scopeKey(roots) };
  }

  #rootSchemaResolution(context: CachedRegistrySchemaResolutionContext): CachedRegistrySchemaResolution | undefined {
    if (!isSchemaObject(context.rootSchema)) return undefined;
    const id = rootSchemaId(context.rootSchema);
    const canonicalUri = id ?? pathToFileURL(resolvePath(context.documentPath)).href;
    return {
      requestedUri: canonicalUri,
      canonicalUri,
      path: resolvePath(context.documentPath),
      schema: context.rootSchema,
    };
  }

  #rootResolution(uri: string, session: Pick<ResolutionSession, 'context'>): CachedRegistrySchemaResolution | undefined {
    const root = this.#rootSchemaResolution(session.context);
    if (!root) return undefined;
    const id = rootSchemaId(session.context.rootSchema);
    if (uri.startsWith('#') || (id !== undefined && uri === id)) return root;
    return undefined;
  }

  #rememberReferenceAlias(resource: string, resolution: CachedSchema, session: ResolutionSession): void {
    const rootId = rootSchemaId(session.context.rootSchema);
    if (!rootId || isAbsoluteUri(resource)) return;
    try {
      const alias = withoutFragment(new URL(resource, rootId).href);
      this.#uriCache.set(cacheKey(session.scope, alias), resolution);
    } catch {
      // Invalid references are reported by the resolver path or authoring rules.
    }
  }

  #cached(scope: string, uri: string): CachedSchema | undefined {
    return this.#uriCache.get(cacheKey(scope, uri)) ?? this.#documentCache.get(uri);
  }

  #requested(cached: CachedSchema | CachedRegistrySchemaResolution, requestedUri: string): CachedRegistrySchemaResolution {
    return { ...cached, requestedUri: withoutFragment(requestedUri) };
  }

  #pathFromValue(value: string): string {
    if (value.startsWith('file:')) {
      try {
        return resolvePath(fileURLToPath(new URL(withoutFragment(value))));
      } catch {
        return value;
      }
    }
    if (isAbsolute(value)) return resolvePath(value);
    return resolvePath(value);
  }

  #pathFor(uri: string, session: { readonly context: CachedRegistrySchemaResolutionContext; readonly documentDirectory: string; readonly roots: readonly string[] }): string {
    if (uri.startsWith('file:')) {
      try {
        return this.#safePath(fileURLToPath(new URL(uri)), session.roots, uri);
      } catch (error) {
        if (error instanceof CachedRegistrySchemaResolverError) throw error;
        throw new CachedRegistrySchemaResolverError('INVALID_URI', `Referenced schema URI is invalid: ${uri} (${errorMessage(error)})`, { uri });
      }
    }
    if (!isAbsoluteUri(uri)) {
      const candidate = resolvePath(session.documentDirectory, decodePath(uri));
      return this.#safePath(candidate, session.roots, uri);
    }

    let parsed: URL;
    try {
      parsed = new URL(uri);
    } catch (error) {
      throw new CachedRegistrySchemaResolverError('INVALID_URI', `Referenced schema URI is invalid: ${uri} (${errorMessage(error)})`, { uri });
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new CachedRegistrySchemaResolverError('UNSUPPORTED_PROTOCOL', `Unsupported referenced schema URI: ${uri}`, { uri });
    }
    throw new CachedRegistrySchemaResolverError('SCHEMA_NOT_FOUND', `No registered schema matches: ${uri}`, { uri });
  }

  #safePath(path: string, roots: readonly string[], uri: string): string {
    const candidate = resolvePath(path);
    if (!roots.some((root) => isInside(root, candidate))) {
      throw new CachedRegistrySchemaResolverError('SCHEMA_OUTSIDE_ROOT', `Referenced schema escapes the trusted schema roots: ${candidate}`, { uri, path: candidate });
    }
    return candidate;
  }

  #ensureIndexSync(session: ResolutionSession): RootIndex {
    const existing = this.#indexes.get(session.scope);
    if (existing) return existing;
    const byId = new Map<string, string>();
    const byPath = new Map<string, Record<string, unknown>>();
    for (const root of session.roots) this.#scanDirectorySync(root, byId, byPath);
    const index = { scopeKey: session.scope, roots: session.roots, byId, byPath };
    this.#indexes.set(session.scope, index);
    return index;
  }

  async #ensureIndex(session: ResolutionSession): Promise<RootIndex> {
    const existing = this.#indexes.get(session.scope);
    if (existing) return existing;
    const inFlight = this.#indexPromises.get(session.scope);
    if (inFlight) return inFlight;
    const generation = this.#generation;
    const promise = (async () => {
      const byId = new Map<string, string>();
      const byPath = new Map<string, Record<string, unknown>>();
      for (const root of session.roots) await this.#scanDirectory(root, byId, byPath, generation);
      const index = { scopeKey: session.scope, roots: session.roots, byId, byPath };
      if (generation === this.#generation) this.#indexes.set(session.scope, index);
      return index;
    })();
    this.#indexPromises.set(session.scope, promise);
    try {
      return await promise;
    } finally {
      if (this.#indexPromises.get(session.scope) === promise) this.#indexPromises.delete(session.scope);
    }
  }

  #scanDirectorySync(directory: string, byId: Map<string, string>, byPath: Map<string, Record<string, unknown>>): void {
    let entries: readonly CachedRegistrySchemaDirectoryEntry[];
    try {
      entries = [...this.#fileSystem.readdirSync(directory)].sort((left, right) => left.name.localeCompare(right.name));
    } catch (error) {
      throw new CachedRegistrySchemaResolverError('SCHEMA_FILE_READ', `Cannot read schema root ${directory}: ${errorMessage(error)}`, { path: directory });
    }
    for (const entry of entries) {
      const path = resolvePath(directory, entry.name);
      if (entry.isDirectory()) this.#scanDirectorySync(path, byId, byPath);
      else if (entry.isFile() && entry.name.endsWith('.json')) this.#indexFileSync(path, byId, byPath);
    }
  }

  async #scanDirectory(directory: string, byId: Map<string, string>, byPath: Map<string, Record<string, unknown>>, generation = this.#generation): Promise<void> {
    let entries: readonly CachedRegistrySchemaDirectoryEntry[];
    try {
      entries = [...await this.#fileSystem.readdir(directory)].sort((left, right) => left.name.localeCompare(right.name));
    } catch (error) {
      throw new CachedRegistrySchemaResolverError('SCHEMA_FILE_READ', `Cannot read schema root ${directory}: ${errorMessage(error)}`, { path: directory });
    }
    for (const entry of entries) {
      const path = resolvePath(directory, entry.name);
      if (entry.isDirectory()) await this.#scanDirectory(path, byId, byPath, generation);
      else if (entry.isFile() && entry.name.endsWith('.json')) await this.#indexFile(path, byId, byPath, generation);
    }
  }

  #indexFileSync(path: string, byId: Map<string, string>, byPath: Map<string, Record<string, unknown>>): void {
    const cached = this.#documentCache.get(path);
    let schema: unknown = cached?.schema;
    if (!schema) {
      try {
        schema = JSON.parse(this.#fileSystem.readFileSync(path)) as unknown;
      } catch {
        return;
      }
    }
    if (!isSchemaObject(schema)) return;
    const id = schemaId(schema);
    if (!id) return;
    const existing = byId.get(id);
    if (existing && existing !== path) throw new CachedRegistrySchemaResolverError('DUPLICATE_SCHEMA_ID', `Duplicate local schema identifier ${id}: ${existing} and ${path}`, { uri: id, path });
    byId.set(id, path);
    byPath.set(path, schema);
    this.#cacheDocument({ requestedUri: id, canonicalUri: id, path, schema }, this.#generation, undefined);
  }

  async #indexFile(path: string, byId: Map<string, string>, byPath: Map<string, Record<string, unknown>>, generation = this.#generation): Promise<void> {
    const cached = this.#documentCache.get(path);
    let schema: unknown = cached?.schema;
    if (!schema) {
      try {
        schema = JSON.parse(await this.#fileSystem.readFile(path)) as unknown;
      } catch {
        return;
      }
    }
    if (!isSchemaObject(schema)) return;
    const id = schemaId(schema);
    if (!id) return;
    const existing = byId.get(id);
    if (existing && existing !== path) throw new CachedRegistrySchemaResolverError('DUPLICATE_SCHEMA_ID', `Duplicate local schema identifier ${id}: ${existing} and ${path}`, { uri: id, path });
    byId.set(id, path);
    byPath.set(path, schema);
    this.#cacheDocument({ requestedUri: id, canonicalUri: id, path, schema }, generation, undefined);
  }

  #loadPathSync(path: string, requestedUri: string, session: { readonly scope: string }): CachedSchema {
    const cached = this.#documentCache.get(path);
    if (cached) {
      this.#uriCache.set(cacheKey(session.scope, requestedUri), cached);
      return cached;
    }
    let raw: string;
    try {
      raw = this.#fileSystem.readFileSync(path);
    } catch (error) {
      throw new CachedRegistrySchemaResolverError('SCHEMA_FILE_READ', `Cannot load referenced schema ${requestedUri} from ${path}: ${errorMessage(error)}`, { uri: requestedUri, path });
    }
    const schema = this.#parseSchema(raw, requestedUri, path);
    const resolution = { requestedUri, canonicalUri: schemaId(schema) ?? pathToFileURL(path).href, path, schema };
    return this.#cacheDocument(resolution, this.#generation, session.scope);
  }

  async #loadPath(path: string, requestedUri: string, session: { readonly scope: string }, generation: number): Promise<CachedSchema> {
    const cached = this.#documentCache.get(path);
    if (cached) {
      this.#uriCache.set(cacheKey(session.scope, requestedUri), cached);
      return cached;
    }
    let raw: string;
    try {
      raw = await this.#fileSystem.readFile(path);
    } catch (error) {
      throw new CachedRegistrySchemaResolverError('SCHEMA_FILE_READ', `Cannot load referenced schema ${requestedUri} from ${path}: ${errorMessage(error)}`, { uri: requestedUri, path });
    }
    const schema = this.#parseSchema(raw, requestedUri, path);
    const resolution = { requestedUri, canonicalUri: schemaId(schema) ?? pathToFileURL(path).href, path, schema };
    return this.#cacheDocument(resolution, generation, session.scope);
  }

  #parseSchema(raw: string, uri: string, path: string): Record<string, unknown> {
    let schema: unknown;
    try {
      schema = JSON.parse(raw) as unknown;
    } catch (error) {
      throw new CachedRegistrySchemaResolverError('SCHEMA_INVALID_JSON', `Referenced schema ${path} is not valid JSON: ${errorMessage(error)}`, { uri, path });
    }
    if (!isSchemaObject(schema)) throw new CachedRegistrySchemaResolverError('SCHEMA_NOT_OBJECT', `Referenced schema ${path} must be a JSON object.`, { uri, path });
    return schema;
  }

  #cacheDocument(resolution: Omit<CachedSchema, 'generation'>, generation: number, scope: string | undefined): CachedSchema {
    const cached: CachedSchema = { ...resolution, generation };
    if (generation === this.#generation) {
      this.#documentCache.set(resolvePath(resolution.path), cached);
      if (scope) this.#uriCache.set(cacheKey(scope, resolution.canonicalUri), cached);
    }
    return cached;
  }

  #removeCached(cached: CachedSchema): void {
    this.#documentCache.delete(resolvePath(cached.path));
    for (const [key, entry] of this.#uriCache) if (entry.path === cached.path) this.#uriCache.delete(key);
  }

  #registrationSet(ajv: CachedRegistrySchemaAjv): Set<string> {
    const object = ajv as object;
    const existing = this.#ajvRegistrations.get(object);
    if (existing) return existing;
    const created = new Set<string>();
    this.#ajvRegistrations.set(object, created);
    return created;
  }

  #registerSchemaSync(ajv: CachedRegistrySchemaAjv, registered: Set<string>, resolution: CachedRegistrySchemaResolution): void {
    this.#registerSchema(ajv, registered, resolution);
  }

  #registerSchema(ajv: CachedRegistrySchemaAjv, registered: Set<string>, resolution: CachedRegistrySchemaResolution): void {
    const keys = unique([
      schemaId(resolution.schema),
      resolution.canonicalUri,
      pathToFileURL(resolvePath(resolution.path)).href,
    ].filter((key): key is string => key !== undefined));
    for (const key of keys) {
      if (registered.has(key) || ajv.getSchema?.(key)) {
        registered.add(key);
        continue;
      }
      try {
        const schema = schemaId(resolution.schema) === key ? resolution.schema : { ...resolution.schema, $id: undefined };
        if ('$id' in schema && schema.$id === undefined) delete schema.$id;
        ajv.addSchema(schema, key);
        registered.add(key);
      } catch (error) {
        throw new CachedRegistrySchemaResolverError('AJV_REGISTRATION', `Cannot register schema ${key}: ${errorMessage(error)}`, { uri: key, path: resolution.path });
      }
    }
  }
}

export function createCachedRegistrySchemaResolver(options: CachedRegistrySchemaResolverOptions = {}): CachedRegistrySchemaResolver {
  return new CachedRegistrySchemaResolver(options);
}

const defaultCachedRegistrySchemaResolver = new CachedRegistrySchemaResolver({
  registryConfiguration: new SchemaRegistryConfiguration(),
});

export function getDefaultCachedRegistrySchemaResolver(): CachedRegistrySchemaResolver {
  return defaultCachedRegistrySchemaResolver;
}
