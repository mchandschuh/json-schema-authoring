import { SchemaRegistryConfiguration } from './registry.js';
import { findSchema, type FindSchemaOptions, type ResolvedSchema } from './resolve.js';
import { CachedRegistrySchemaResolver, createCachedRegistrySchemaResolver } from './cached-registry-schema-resolver.js';
import { SchemaInstanceValidator, type InstanceValidationOptions, type InstanceValidationReport } from './instance.js';
import { SchemaValidator, type ValidateSchemaOptions, type ValidationReport } from './validator.js';
import type { SchemaResolution, SchemaResolver, SchemaResolverContext } from './resolver-contract.js';
import type { SchemaRule } from './types.js';

export interface JsonSchemaRegistryOptions {
  readonly schemaRoots?: readonly string[];
  readonly registryConfiguration?: SchemaRegistryConfiguration;
  readonly schemaResolver?: SchemaResolver;
  readonly rules?: readonly SchemaRule[];
}

export interface JsonSchemaRegistryResolveOptions extends SchemaResolverContext {}

export class JsonSchemaRegistry {
  readonly #schemaResolver: SchemaResolver;
  readonly #schemaValidator: SchemaValidator;
  readonly #instanceValidator: SchemaInstanceValidator;
  readonly #schemaRoots: readonly string[];

  constructor(options: JsonSchemaRegistryOptions = {}) {
    this.#schemaRoots = options.schemaRoots ?? [];
    this.#schemaResolver = options.schemaResolver ?? createCachedRegistrySchemaResolver({
      schemaRoots: options.schemaRoots,
      registryConfiguration: options.registryConfiguration,
    });
    this.#schemaValidator = new SchemaValidator({
      rules: options.rules,
      schemaRoots: this.#schemaRoots,
      schemaResolver: this.#schemaResolver,
    });
    this.#instanceValidator = new SchemaInstanceValidator({ schemaResolver: this.#schemaResolver });
  }

  resolveSync(uri: string, options: JsonSchemaRegistryResolveOptions): SchemaResolution {
    return this.#schemaResolver.resolveSync(uri, this.#context(options));
  }

  resolve(uri: string, options: JsonSchemaRegistryResolveOptions): Promise<SchemaResolution> {
    return this.#schemaResolver.resolve(uri, this.#context(options));
  }

  resolveManySync(uris: readonly string[], options: JsonSchemaRegistryResolveOptions): readonly SchemaResolution[] {
    return this.#schemaResolver.resolveManySync(uris, this.#context(options));
  }

  resolveMany(uris: readonly string[], options: JsonSchemaRegistryResolveOptions): Promise<readonly SchemaResolution[]> {
    return this.#schemaResolver.resolveMany(uris, this.#context(options));
  }

  find(options: FindSchemaOptions): Promise<ResolvedSchema> {
    return findSchema({ ...options, schemaRoots: this.#combinedRoots(options.schemaRoots) });
  }

  validateSchema(content: unknown, options: ValidateSchemaOptions = {}): ValidationReport {
    return this.#schemaValidator.validate(options.documentPath ?? '<content>', content);
  }

  validateSchemaAsync(content: unknown, options: ValidateSchemaOptions = {}): Promise<ValidationReport> {
    return this.#schemaValidator.validateAsync(options.documentPath ?? '<content>', content);
  }

  validateInstance(schema: unknown, instance: unknown, options: InstanceValidationOptions): InstanceValidationReport {
    return this.#instanceValidator.validate(schema, instance, {
      ...options,
      schemaRoots: this.#combinedRoots(options.schemaRoots),
    });
  }

  validateInstanceAsync(schema: unknown, instance: unknown, options: InstanceValidationOptions): Promise<InstanceValidationReport> {
    return this.#instanceValidator.validateAsync(schema, instance, {
      ...options,
      schemaRoots: this.#combinedRoots(options.schemaRoots),
    });
  }

  #context(options: JsonSchemaRegistryResolveOptions): SchemaResolverContext {
    return {
      documentPath: options.documentPath,
      rootSchema: options.rootSchema,
      schemaRoots: this.#combinedRoots(options.schemaRoots),
    };
  }

  #combinedRoots(roots?: readonly string[]): readonly string[] {
    return [...new Set([...this.#schemaRoots, ...(roots ?? [])])];
  }
}

export function createJsonSchemaRegistry(options: JsonSchemaRegistryOptions = {}): JsonSchemaRegistry {
  return new JsonSchemaRegistry(options);
}

const defaultJsonSchemaRegistry = new JsonSchemaRegistry();

export function getDefaultJsonSchemaRegistry(): JsonSchemaRegistry {
  return defaultJsonSchemaRegistry;
}