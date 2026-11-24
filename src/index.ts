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