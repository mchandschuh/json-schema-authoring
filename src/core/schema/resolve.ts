import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import {
  listSchemasInDirectories,
  listSchemasInDirectoriesSync,
  SchemaRegistryConfiguration,
  type RegisteredSchema,
} from './registry.js';

export class SchemaResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SchemaResolutionError';
  }
}

export interface ResolveSchemaOptions {
  readonly configuration?: SchemaRegistryConfiguration;
  /** Additional schema directories to search alongside configured registry directories. */
  readonly schemaRoots?: readonly string[];
}

export interface FindSchemaOptions extends ResolveSchemaOptions {
  /** Exact URI, URI fragment, or filename-like search text. */
  readonly searchString?: string;
  /** Alias for searchString. */
  readonly search?: string;
  /** Alias for searchString for callers that already have a schema URI. */
  readonly schemaUri?: string;
  /** Schema type to search for, optionally combined with version. */
  readonly schemaType?: string;
  /** Alias for schemaType. */
  readonly type?: string;
  /** Optional major version used with type/schemaType. */
  readonly version?: string | number;
}

export interface ResolvedSchema {
  readonly id: string;
  readonly path: string;
  readonly schema: Record<string, unknown>;
}

function searchValue(searchString: string): string {
  const search = searchString.trim();
  if (!search) throw new SchemaResolutionError('A schema type is required.');
  return search;
}

function matchingSchemas(search: string, schemas: readonly RegisteredSchema[]): RegisteredSchema {
  const matches = schemas.filter(({ id: fullUri }) => fullUri.includes(search));

  if (matches.length === 0) {
    throw new SchemaResolutionError(`No registered schema matches: ${search}`);
  }
  if (matches.length !== 1) {
    throw new SchemaResolutionError(
      `Schema search is ambiguous: ${search} matched ${matches.length} registered schemas: ${matches.map(({ id }) => id).join(', ')}`,
    );
  }

  return matches[0]!;
}

function rootsFor(options: ResolveSchemaOptions, configured: readonly { readonly directory: string }[]): readonly string[] {
  return [...new Set([
    ...(options.schemaRoots ?? []),
    ...configured.map(({ directory }) => directory),
  ])];
}

async function schemasFor(options: ResolveSchemaOptions): Promise<readonly RegisteredSchema[]> {
  const configuration = options.configuration ?? new SchemaRegistryConfiguration();
  const configured = await configuration.list('all');
  return listSchemasInDirectories(rootsFor(options, configured));
}

function schemasForSync(options: ResolveSchemaOptions): readonly RegisteredSchema[] {
  const configuration = options.configuration ?? new SchemaRegistryConfiguration();
  const configured = configuration.listSync('all');
  return listSchemasInDirectoriesSync(rootsFor(options, configured));
}

async function readResolvedSchema(match: RegisteredSchema): Promise<ResolvedSchema> {
  let schema: unknown;
  try {
    schema = JSON.parse(await readFile(match.path, 'utf8')) as unknown;
  } catch (error) {
    throw new SchemaResolutionError(`Cannot read registered schema ${match.path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isRecordSchema(schema)) {
    throw new SchemaResolutionError(`Registered schema ${match.path} must contain a JSON object.`);
  }
  return { id: match.id, path: match.path, schema };
}

function readResolvedSchemaSync(match: RegisteredSchema): ResolvedSchema {
  let schema: unknown;
  try {
    schema = JSON.parse(readFileSync(match.path, 'utf8')) as unknown;
  } catch (error) {
    throw new SchemaResolutionError(`Cannot read registered schema ${match.path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isRecordSchema(schema)) {
    throw new SchemaResolutionError(`Registered schema ${match.path} must contain a JSON object.`);
  }
  return { id: match.id, path: match.path, schema };
}

function isRecordSchema(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Resolve a schema from the local registry catalog used by the `list` command.
 * The input is intentionally a substring: callers may provide a complete URI,
 * a namespace/type/version suffix, or a filename-like schema type.
 */
export async function resolveRegisteredSchema(
  searchString: string,
  options: ResolveSchemaOptions = {},
): Promise<ResolvedSchema> {
  const [result] = await resolveRegisteredSchemas([searchString], options);
  return result!;
}

/** Resolve one schema from the local registry using blocking filesystem access. */
export function resolveRegisteredSchemaSync(
  searchString: string,
  options: ResolveSchemaOptions = {},
): ResolvedSchema {
  const [result] = resolveRegisteredSchemasSync([searchString], options);
  return result!;
}

/** Resolve multiple schemas from one local registry scan. */
export async function resolveRegisteredSchemas(
  searchStrings: readonly string[],
  options: ResolveSchemaOptions = {},
): Promise<readonly ResolvedSchema[]> {
  const searches = searchStrings.map(searchValue);
  const schemas = await schemasFor(options);
  const matches = searches.map((search) => matchingSchemas(search, schemas));
  return Promise.all(matches.map(readResolvedSchema));
}

/** Resolve multiple schemas from one blocking local registry scan. */
export function resolveRegisteredSchemasSync(
  searchStrings: readonly string[],
  options: ResolveSchemaOptions = {},
): readonly ResolvedSchema[] {
  const searches = searchStrings.map(searchValue);
  const schemas = schemasForSync(options);
  return searches.map((search) => readResolvedSchemaSync(matchingSchemas(search, schemas)));
}

function searchStringFor(options: FindSchemaOptions): string {
  const direct = options.searchString ?? options.search ?? options.schemaUri;
  if (direct !== undefined) return direct;

  const type = options.schemaType ?? options.type;
  if (type !== undefined && options.version !== undefined) {
    const version = String(options.version).replace(/^v/, '');
    return `${type}/v${version}`;
  }
  if (type !== undefined) return type;
  throw new SchemaResolutionError('findSchema requires a searchString, schemaUri, or schemaType.');
}

/** Find exactly one schema in the local registered schema catalog. */
export async function findSchema(options: FindSchemaOptions): Promise<ResolvedSchema>;
export async function findSchema(searchString: string, options?: ResolveSchemaOptions): Promise<ResolvedSchema>;
export async function findSchema(
  optionsOrSearchString: FindSchemaOptions | string,
  resolveOptions: ResolveSchemaOptions = {},
): Promise<ResolvedSchema> {
  if (typeof optionsOrSearchString === 'string') return resolveRegisteredSchema(optionsOrSearchString, resolveOptions);
  return resolveRegisteredSchema(searchStringFor(optionsOrSearchString), optionsOrSearchString);
}