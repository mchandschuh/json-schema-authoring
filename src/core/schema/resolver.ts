import { readFile, readdir } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isSchemaObject } from './types.js';

export interface SchemaResolverOptions {
  readonly documentPath: string;
  readonly rootSchema: unknown;
  /** Directory containing the complete local schema collection. */
  readonly schemaRoot?: string;
}

export interface SchemaRegistry {
  addSchema(schema: Record<string, unknown>, key?: string): unknown;
  getSchema?(key: string): unknown;
}

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

/**
 * Resolves JSON Schema references to local files without making network calls.
 * Relative references are resolved from the referencing document directory.
 * When a schema collection root is supplied, local schema identifiers are indexed
 * so stable public IDs continue to resolve after files are moved into nested
 * family/version directories. Network retrieval is never attempted.
 */
export class LocalSchemaResolver {
  readonly #documentPath: string;
  readonly #documentDirectory: string;
  readonly #schemaRoot: string;
  readonly #indexLocalIds: boolean;
  readonly #rootSchema: unknown;
  readonly #uriToPath = new Map<string, string>();
  readonly #indexedSchemas = new Map<string, Record<string, unknown>>();
  readonly #pathAliases = new Map<string, Set<string>>();
  readonly #canonicalIds = new Set<string>();
  #indexPromise: Promise<void> | undefined;

  constructor(options: SchemaResolverOptions) {
    this.#documentPath = resolve(options.documentPath);
    this.#documentDirectory = dirname(this.#documentPath);
    this.#schemaRoot = resolve(options.schemaRoot ?? this.#documentDirectory);
    this.#indexLocalIds = options.schemaRoot !== undefined;
    this.#rootSchema = options.rootSchema;
    const rootId = isSchemaObject(options.rootSchema) && typeof options.rootSchema.$id === 'string'
      ? options.rootSchema.$id
      : undefined;
    if (rootId) {
      this.#uriToPath.set(withoutFragment(rootId), this.#documentPath);
      this.#indexRelativeReferences(this.#documentPath, options.rootSchema as Record<string, unknown>);
    }
  }

  async load(uri: string): Promise<Record<string, unknown>> {
    const normalizedUri = withoutFragment(uri);
    await this.#ensureIndex();
    const knownPath = this.#uriToPath.get(normalizedUri);
    const documentPath = knownPath ? this.#safePath(knownPath) : await this.#pathFor(normalizedUri);
    this.#uriToPath.set(normalizedUri, documentPath);

    let raw: string;
    try {
      raw = await readFile(documentPath, 'utf8');
    } catch (error) {
      throw new Error(`Cannot load referenced schema ${uri} from ${documentPath}: ${error instanceof Error ? error.message : String(error)}`);
    }

    let schema: unknown;
    try {
      schema = JSON.parse(raw) as unknown;
    } catch (error) {
      throw new Error(`Referenced schema ${documentPath} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!isSchemaObject(schema)) throw new Error(`Referenced schema ${documentPath} must be a JSON object.`);

    if (typeof schema.$id === 'string') this.#uriToPath.set(withoutFragment(schema.$id), documentPath);
    return schema;
  }

  /** Register indexed files and aliases for synchronous child-example checks. */
  async registerWith(registry: SchemaRegistry): Promise<void> {
    await this.#ensureIndex();
    for (const [path, schema] of this.#indexedSchemas) {
      for (const alias of this.#pathAliases.get(path) ?? []) {
        if (alias === schema.$id || this.#canonicalIds.has(withoutFragment(alias))) continue;
        if (registry.getSchema?.(alias)) continue;
        const aliasSchema = { ...schema };
        delete aliasSchema.$id;
        registry.addSchema(aliasSchema, alias);
      }
    }
  }

  async #ensureIndex(): Promise<void> {
    if (!this.#indexLocalIds) return;
    if (!this.#indexPromise) this.#indexPromise = this.#indexSchemaFiles(this.#schemaRoot);
    await this.#indexPromise;
  }

  async #indexSchemaFiles(directory: string): Promise<void> {
    let entries;
    try {
      entries = (await readdir(directory, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name));
    } catch (error) {
      throw new Error(`Cannot read schema root ${directory}: ${error instanceof Error ? error.message : String(error)}`);
    }
    for (const entry of entries) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        await this.#indexSchemaFiles(path);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith('.schema.json') || path === this.#documentPath) continue;
      let schema: unknown;
      try {
        schema = JSON.parse(await readFile(path, 'utf8')) as unknown;
      } catch {
        continue;
      }
      if (!isSchemaObject(schema) || typeof schema.$id !== 'string') continue;
      this.#indexedSchemas.set(path, schema);
      const aliases = this.#pathAliases.get(path) ?? new Set<string>();
      aliases.add(pathToFileURL(path).href);
      this.#pathAliases.set(path, aliases);
      const id = withoutFragment(schema.$id);
      this.#canonicalIds.add(id);
      const existing = this.#uriToPath.get(id);
      if (existing && existing !== path) throw new Error(`Duplicate local schema identifier ${id}: ${existing} and ${path}`);
      this.#uriToPath.set(id, path);
      this.#indexRelativeReferences(path, schema);
    }
  }

  #indexRelativeReferences(documentPath: string, schema: Record<string, unknown>): void {
    if (typeof schema.$id !== 'string') return;
    const visit = (value: unknown): void => {
      if (Array.isArray(value)) {
        value.forEach(visit);
        return;
      }
      if (typeof value !== 'object' || value === null) return;
      for (const [key, child] of Object.entries(value)) {
        if (key === '$ref' && typeof child === 'string' && !child.startsWith('#')) {
          const base = withoutFragment(child);
          if (!/^[A-Za-z][A-Za-z0-9+.-]*:/.test(base)) {
            const target = resolve(dirname(documentPath), decodePath(base));
            try {
              const resolvedUri = new URL(child, schema.$id as string).href;
              this.#uriToPath.set(withoutFragment(resolvedUri), target);
              if (isInside(this.#schemaRoot, target)) {
                this.#uriToPath.set(withoutFragment(resolvedUri), target);
                const alias = withoutFragment(resolvedUri);
                if (!this.#canonicalIds.has(alias)) {
                  this.#pathAliases.get(target)?.add(alias) ?? this.#pathAliases.set(target, new Set([alias]));
                }
              }
            } catch {
              // The schema authoring rules report invalid identifiers. Do not
              // turn an unrelated index pass into an unbounded filesystem read.
            }
          }
        } else visit(child);
      }
    };
    visit(schema);
  }

  async #pathFor(uri: string): Promise<string> {
    if (uri.startsWith('file:')) return this.#safePath(fileURLToPath(new URL(uri)));
    if (!/^[A-Za-z][A-Za-z0-9+.-]*:/.test(uri)) return this.#safePath(resolve(this.#documentDirectory, decodePath(uri)));

    let parsed: URL;
    try {
      parsed = new URL(uri);
    } catch (error) {
      throw new Error(`Referenced schema URI is invalid: ${uri} (${error instanceof Error ? error.message : String(error)})`);
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error(`Unsupported referenced schema URI: ${uri}`);

    const rootId = isSchemaObject(this.#rootSchema) && typeof this.#rootSchema.$id === 'string'
      ? this.#rootSchema.$id
      : undefined;
    if (rootId) {
      try {
        const rootUrl = new URL(rootId);
        if (rootUrl.origin === parsed.origin) {
          const schemaRootPath = parsed.pathname.replace(/^\/+/, '');
          const rootMappedPath = resolve(this.#schemaRoot, decodePath(schemaRootPath));
          if (isInside(this.#schemaRoot, rootMappedPath)) {
            try {
              await readFile(rootMappedPath);
              return rootMappedPath;
            } catch {
              // The public URI may be a legacy identifier. Fall back to the
              // root document's local directory below.
            }
          }

          const rootDirectoryUrlPath = rootUrl.pathname.slice(0, rootUrl.pathname.lastIndexOf('/') + 1);
          const targetUrlPath = parsed.pathname.startsWith(rootDirectoryUrlPath)
            ? parsed.pathname.slice(rootDirectoryUrlPath.length)
            : parsed.pathname.replace(/^\/+/, '');
          return this.#safePath(resolve(this.#documentDirectory, decodePath(targetUrlPath)));
        }
      } catch {
        throw new Error(`Root schema identifier is not a valid URI: ${rootId}`);
      }
    }
    if (this.#indexLocalIds) throw new Error(`Referenced local schema is not indexed within the schema root: ${uri}`);
    throw new Error(`Network schema resolution is disabled for external URI: ${uri}`);
  }

  #safePath(candidate: string): string {
    const normalized = resolve(candidate);
    if (!isInside(this.#schemaRoot, normalized)) throw new Error(`Referenced schema escapes the schema root: ${normalized}`);
    return normalized;
  }
}