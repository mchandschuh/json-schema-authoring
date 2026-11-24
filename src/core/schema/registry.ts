import { lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { lstat, mkdir, readdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { isSchemaObject } from './types.js';

export type RegistryConfigLocation = 'app' | 'home' | 'env';
export type RegistryConfigSelection = RegistryConfigLocation | 'all';

export interface RegistryConfigurationOptions {
  readonly cwd?: string;
  readonly homeDirectory?: string;
  readonly environment?: Readonly<Record<string, string | undefined>>;
}

export interface RegisteredDirectory {
  readonly directory: string;
  readonly location: RegistryConfigLocation;
  readonly configPath: string;
}

export interface RegisteredSchema {
  readonly id: string;
  readonly path: string;
  readonly directory: string;
  readonly locations: readonly RegistryConfigLocation[];
}

export class SchemaRegistryConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SchemaRegistryConfigurationError';
  }
}

interface ConfigRoot {
  readonly location: RegistryConfigLocation;
  readonly directory: string;
  readonly configPath: string;
  readonly required: boolean;
}

interface RegistryConfigDocument {
  readonly [key: string]: unknown;
}

interface SchemaScanDirectory {
  readonly directory: string;
  readonly location?: RegistryConfigLocation;
}

const CONFIG_FILE = 'config.json';
const REGISTRY_KEY = 'schemaRegistry';
const DIRECTORIES_KEY = 'directories';

function jsonObject(value: unknown, description: string): RegistryConfigDocument {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new SchemaRegistryConfigurationError(`${description} must contain a JSON object.`);
  }
  return value as RegistryConfigDocument;
}

function environment(options: RegistryConfigurationOptions): Readonly<Record<string, string | undefined>> {
  return options.environment ?? process.env;
}

function rootFor(location: RegistryConfigLocation, options: RegistryConfigurationOptions): ConfigRoot {
  const cwd = resolve(options.cwd ?? process.cwd());
  if (location === 'app') {
    const directory = resolve(cwd, '.config');
    return { location, directory, configPath: join(directory, CONFIG_FILE), required: false };
  }
  if (location === 'home') {
    const directory = resolve(options.homeDirectory ?? homedir(), '.schema-validate');
    return { location, directory, configPath: join(directory, CONFIG_FILE), required: false };
  }
  const value = environment(options).SDLC_CONFIG;
  if (!value) throw new SchemaRegistryConfigurationError('SDLC_CONFIG must be set to use the env configuration location.');
  if (!isAbsolute(value)) throw new SchemaRegistryConfigurationError('SDLC_CONFIG must be an absolute directory.');
  const directory = resolve(value);
  return { location, directory, configPath: join(directory, CONFIG_FILE), required: true };
}

async function inspectRoot(root: ConfigRoot, create: boolean): Promise<boolean> {
  if (create && !root.required) await mkdir(root.directory, { recursive: true });
  try {
    const info = await lstat(root.directory);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new SchemaRegistryConfigurationError(`Configuration ${root.location} root must be a real directory: ${root.directory}`);
    return true;
  } catch (error) {
    if (error instanceof SchemaRegistryConfigurationError) throw error;
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' && !root.required) return false;
    throw new SchemaRegistryConfigurationError(`Configuration ${root.location} root could not be inspected: ${root.directory}`);
  }
}

function inspectRootSync(root: ConfigRoot, create: boolean): boolean {
  if (create && !root.required) mkdirSync(root.directory, { recursive: true });
  try {
    const info = lstatSync(root.directory);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new SchemaRegistryConfigurationError(`Configuration ${root.location} root must be a real directory: ${root.directory}`);
    return true;
  } catch (error) {
    if (error instanceof SchemaRegistryConfigurationError) throw error;
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' && !root.required) return false;
    throw new SchemaRegistryConfigurationError(`Configuration ${root.location} root could not be inspected: ${root.directory}`);
  }
}

function rootsFor(selection: RegistryConfigSelection, options: RegistryConfigurationOptions): readonly ConfigRoot[] {
  if (selection === 'all') {
    const roots = [rootFor('app', options), rootFor('home', options)];
    if (environment(options).SDLC_CONFIG !== undefined) roots.push(rootFor('env', options));
    return roots;
  }
  return [rootFor(selection, options)];
}

async function readDocument(root: ConfigRoot): Promise<RegistryConfigDocument> {
  try {
    const source = await readFile(root.configPath, 'utf8');
    return jsonObject(JSON.parse(source) as unknown, `Configuration file ${root.configPath}`);
  } catch (error) {
    if (error instanceof SchemaRegistryConfigurationError) throw error;
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw new SchemaRegistryConfigurationError(`Configuration file ${root.configPath} is not valid JSON.`);
  }
}

function readDocumentSync(root: ConfigRoot): RegistryConfigDocument {
  try {
    const source = readFileSync(root.configPath, 'utf8');
    return jsonObject(JSON.parse(source) as unknown, `Configuration file ${root.configPath}`);
  } catch (error) {
    if (error instanceof SchemaRegistryConfigurationError) throw error;
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw new SchemaRegistryConfigurationError(`Configuration file ${root.configPath} is not valid JSON.`);
  }
}

function configuredValues(document: RegistryConfigDocument): readonly string[] {
  const registry = document[REGISTRY_KEY];
  if (registry === undefined) return [];
  const registryObject = jsonObject(registry, `Configuration property ${REGISTRY_KEY}`);
  const directories = registryObject[DIRECTORIES_KEY];
  if (directories === undefined) return [];
  if (!Array.isArray(directories) || directories.some((directory) => typeof directory !== 'string' || directory.trim().length === 0)) {
    throw new SchemaRegistryConfigurationError(`Configuration property ${REGISTRY_KEY}.${DIRECTORIES_KEY} must be an array of non-empty strings.`);
  }
  return directories as string[];
}

function valuePath(root: ConfigRoot, value: string): string {
  return isAbsolute(value) ? resolve(value) : resolve(root.directory, value);
}

async function canonicalDirectory(path: string, description: string): Promise<string> {
  try {
    const info = await lstat(path);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new SchemaRegistryConfigurationError(`${description} must be a real directory: ${path}`);
    return await realpath(path);
  } catch (error) {
    if (error instanceof SchemaRegistryConfigurationError) throw error;
    throw new SchemaRegistryConfigurationError(`${description} does not exist or cannot be read: ${path}`);
  }
}

function canonicalDirectorySync(path: string, description: string): string {
  try {
    const info = lstatSync(path);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new SchemaRegistryConfigurationError(`${description} must be a real directory: ${path}`);
    return realpathSync(path);
  } catch (error) {
    if (error instanceof SchemaRegistryConfigurationError) throw error;
    throw new SchemaRegistryConfigurationError(`${description} does not exist or cannot be read: ${path}`);
  }
}

async function entriesFor(root: ConfigRoot, validateDirectories = true): Promise<RegisteredDirectory[]> {
  if (!(await inspectRoot(root, false))) return [];
  const document = await readDocument(root);
  const entries: RegisteredDirectory[] = [];
  for (const value of configuredValues(document)) {
    const directory = valuePath(root, value);
    const normalized = validateDirectories
      ? await canonicalDirectory(directory, `Registered schema directory in ${root.configPath}`)
      : directory;
    entries.push({ directory: normalized, location: root.location, configPath: root.configPath });
  }
  return entries;
}

function entriesForSync(root: ConfigRoot, validateDirectories = true): RegisteredDirectory[] {
  if (!inspectRootSync(root, false)) return [];
  const document = readDocumentSync(root);
  const entries: RegisteredDirectory[] = [];
  for (const value of configuredValues(document)) {
    const directory = valuePath(root, value);
    const normalized = validateDirectories
      ? canonicalDirectorySync(directory, `Registered schema directory in ${root.configPath}`)
      : directory;
    entries.push({ directory: normalized, location: root.location, configPath: root.configPath });
  }
  return entries;
}

async function writeDocument(root: ConfigRoot, document: RegistryConfigDocument, directories: readonly string[]): Promise<void> {
  const registry = jsonObject(document[REGISTRY_KEY] ?? {}, `Configuration property ${REGISTRY_KEY}`);
  const nextRegistry = { ...registry, [DIRECTORIES_KEY]: directories };
  const next = { ...document, [REGISTRY_KEY]: nextRegistry };
  await writeFile(root.configPath, `${JSON.stringify(next, null, 2)}
`, 'utf8');
}

function resolvedInput(directory: string, options: RegistryConfigurationOptions): string {
  return resolve(options.cwd ?? process.cwd(), directory);
}

async function matchingDirectory(directory: string): Promise<string> {
  try {
    return await canonicalDirectory(directory, 'Schema registry directory');
  } catch {
    return resolve(directory);
  }
}

export class SchemaRegistryConfiguration {
  readonly #options: RegistryConfigurationOptions;

  constructor(options: RegistryConfigurationOptions = {}) {
    this.#options = options;
  }

  async list(selection: RegistryConfigSelection = 'all'): Promise<readonly RegisteredDirectory[]> {
    const entries: RegisteredDirectory[] = [];
    for (const root of rootsFor(selection, this.#options)) entries.push(...await entriesFor(root));
    return entries.sort((left, right) => left.directory.localeCompare(right.directory) || left.location.localeCompare(right.location));
  }

  listSync(selection: RegistryConfigSelection = 'all'): readonly RegisteredDirectory[] {
    const entries: RegisteredDirectory[] = [];
    for (const root of rootsFor(selection, this.#options)) entries.push(...entriesForSync(root));
    return entries.sort((left, right) => left.directory.localeCompare(right.directory) || left.location.localeCompare(right.location));
  }

  async add(directory: string, location: RegistryConfigLocation = 'home'): Promise<{ readonly entry: RegisteredDirectory; readonly added: boolean }> {
    const root = rootFor(location, this.#options);
    await inspectRoot(root, true);
    const normalized = await canonicalDirectory(resolvedInput(directory, this.#options), 'Schema registry directory');
    const document = await readDocument(root);
    const existing = configuredValues(document).map((value) => valuePath(root, value));
    const alreadyConfigured = existing.some((value) => value === normalized || (isAbsolute(value) && resolve(value) === normalized));
    if (!alreadyConfigured) await writeDocument(root, document, [...existing, normalized]);
    return { entry: { directory: normalized, location, configPath: root.configPath }, added: !alreadyConfigured };
  }

  async remove(directory: string, location: RegistryConfigLocation = 'home'): Promise<{ readonly entry: RegisteredDirectory; readonly removed: boolean }> {
    const root = rootFor(location, this.#options);
    if (!(await inspectRoot(root, false))) throw new SchemaRegistryConfigurationError(`No ${location} configuration exists at ${root.configPath}.`);
    const document = await readDocument(root);
    const configured = configuredValues(document);
    const target = await matchingDirectory(resolvedInput(directory, this.#options));
    let removed = false;
    const remaining: string[] = [];
    for (const value of configured) {
      const candidate = valuePath(root, value);
      const normalized = await matchingDirectory(candidate);
      if (!removed && (normalized === target || resolve(candidate) === target)) {
        removed = true;
        continue;
      }
      remaining.push(value);
    }
    if (!removed) throw new SchemaRegistryConfigurationError(`Schema registry directory is not configured in ${location}: ${target}`);
    await writeDocument(root, document, remaining);
    return { entry: { directory: target, location, configPath: root.configPath }, removed: true };
  }

  async directories(selection: RegistryConfigSelection = 'all'): Promise<readonly RegisteredDirectory[]> {
    return this.list(selection);
  }

  directoriesSync(selection: RegistryConfigSelection = 'all'): readonly RegisteredDirectory[] {
    return this.listSync(selection);
  }
}

async function filesUnder(directory: string, output: string[]): Promise<void> {
  const entries = (await readdir(directory, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) await filesUnder(path, output);
    else if (entry.isFile() && entry.name.endsWith('.json')) output.push(path);
  }
}

function filesUnderSync(directory: string, output: string[]): void {
  const entries = readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) filesUnderSync(path, output);
    else if (entry.isFile() && entry.name.endsWith('.json')) output.push(path);
  }
}

async function listSchemas(entries: readonly SchemaScanDirectory[]): Promise<readonly RegisteredSchema[]> {
  const byPath = new Map<string, RegisteredSchema>();
  for (const entry of entries) {
    const files: string[] = [];
    await filesUnder(entry.directory, files);
    for (const path of files) {
      let schema: unknown;
      try {
        schema = JSON.parse(await readFile(path, 'utf8')) as unknown;
      } catch {
        continue;
      }
      if (!isSchemaObject(schema) || typeof schema.$id !== 'string' || schema.$id.trim().length === 0) continue;
      const previous = byPath.get(path);
      const locationsForPath = new Set(previous?.locations ?? []);
      if (entry.location) locationsForPath.add(entry.location);
      byPath.set(path, {
        id: schema.$id,
        path,
        directory: previous?.directory ?? entry.directory,
        locations: [...locationsForPath].sort(),
      });
    }
  }
  return [...byPath.values()].sort((left, right) => left.id.localeCompare(right.id) || left.path.localeCompare(right.path));
}

function listSchemasSync(entries: readonly SchemaScanDirectory[]): readonly RegisteredSchema[] {
  const byPath = new Map<string, RegisteredSchema>();
  for (const entry of entries) {
    const files: string[] = [];
    filesUnderSync(entry.directory, files);
    for (const path of files) {
      let schema: unknown;
      try {
        schema = JSON.parse(readFileSync(path, 'utf8')) as unknown;
      } catch {
        continue;
      }
      if (!isSchemaObject(schema) || typeof schema.$id !== 'string' || schema.$id.trim().length === 0) continue;
      const previous = byPath.get(path);
      const locationsForPath = new Set(previous?.locations ?? []);
      if (entry.location) locationsForPath.add(entry.location);
      byPath.set(path, {
        id: schema.$id,
        path,
        directory: previous?.directory ?? entry.directory,
        locations: [...locationsForPath].sort(),
      });
    }
  }
  return [...byPath.values()].sort((left, right) => left.id.localeCompare(right.id) || left.path.localeCompare(right.path));
}

export async function listRegisteredSchemas(entries: readonly RegisteredDirectory[]): Promise<readonly RegisteredSchema[]> {
  return listSchemas(entries);
}

export function listRegisteredSchemasSync(entries: readonly RegisteredDirectory[]): readonly RegisteredSchema[] {
  return listSchemasSync(entries);
}

export async function listSchemasInDirectories(directories: readonly string[]): Promise<readonly RegisteredSchema[]> {
  return listSchemas(directories.map((directory) => ({ directory: resolve(directory) })));
}

export function listSchemasInDirectoriesSync(directories: readonly string[]): readonly RegisteredSchema[] {
  return listSchemasSync(directories.map((directory) => ({ directory: resolve(directory) })));
}

