export { loadSchema } from './core/schema/resolver.js';
export type { LoadSchemaOptions } from './core/schema/resolver.js';

export {
  findSchema,
  resolveRegisteredSchema,
  resolveRegisteredSchemaSync,
  resolveRegisteredSchemas,
  resolveRegisteredSchemasSync,
  SchemaResolutionError,
} from './core/schema/resolve.js';
export type {
  FindSchemaOptions,
  ResolveSchemaOptions,
  ResolvedSchema,
} from './core/schema/resolve.js';

export {
  DIALECT,
  SchemaValidator,
  validateSchema,
} from './core/schema/validator.js';
export type {
  SchemaValidatorOptions,
  ValidateSchemaOptions,
  ValidationReport,
} from './core/schema/validator.js';

export {
  SchemaInstanceValidator,
  validateInstance,
  validateInstanceAsync,
} from './core/schema/instance.js';
export type {
  AsyncInstanceValidationOptions,
  InstanceValidationOptions,
  InstanceValidationError,
  InstanceValidationReport,
  SchemaInstanceValidatorOptions,
} from './core/schema/instance.js';

export {
  CachedRegistrySchemaResolver,
  CachedRegistrySchemaResolverError,
  createCachedRegistrySchemaResolver,
  getDefaultCachedRegistrySchemaResolver,
} from './core/schema/cached-registry-schema-resolver.js';
export type {
  CachedRegistrySchemaAjv,
  CachedRegistrySchemaDirectoryEntry,
  CachedRegistrySchemaFileSystem,
  CachedRegistrySchemaResolution,
  CachedRegistrySchemaResolutionContext,
  CachedRegistrySchemaResolverErrorCode,
  CachedRegistrySchemaResolverOptions,
} from './core/schema/cached-registry-schema-resolver.js';
export type {
  SchemaResolver,
  SchemaResolverAjv,
  SchemaResolverContext,
} from './core/schema/resolver-contract.js';