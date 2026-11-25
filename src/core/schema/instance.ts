import { Ajv2020, type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js';
import { getDefaultCachedRegistrySchemaResolver } from './cached-registry-schema-resolver.js';
import type { SchemaResolver } from './resolver-contract.js';

export interface InstanceValidationError {
  readonly instancePath: string;
  readonly keyword: string;
  readonly message: string;
  readonly params: Record<string, unknown>;
}

export interface InstanceValidationReport {
  readonly valid: boolean;
  readonly errors: readonly InstanceValidationError[];
}

export interface InstanceValidationOptions {
  readonly documentPath: string;
  readonly schemaRoots?: readonly string[];
  readonly schemaResolver?: SchemaResolver;
}

export interface SchemaInstanceValidatorOptions {
  readonly schemaResolver?: SchemaResolver;
}

function normalizeError(error: ErrorObject): InstanceValidationError {
  return {
    instancePath: error.instancePath || '$',
    keyword: error.keyword,
    message: error.message ?? 'is invalid',
    params: error.params,
  };
}

export class SchemaInstanceValidator {
  readonly #schemaResolver: SchemaResolver;

  constructor(options: SchemaInstanceValidatorOptions = {}) {
    this.#schemaResolver = options.schemaResolver ?? getDefaultCachedRegistrySchemaResolver();
  }

  validate(schema: unknown, instance: unknown, options: InstanceValidationOptions): InstanceValidationReport {
    let compiled: ValidateFunction;
    try {
      const ajv = this.#createAjv();
      const resolver = options.schemaResolver ?? this.#schemaResolver;
      const context = { documentPath: options.documentPath, rootSchema: schema, schemaRoots: options.schemaRoots ?? [] };
      resolver.registerSync(ajv, context);
      compiled = ajv.compile(schema as Record<string, unknown>);
    } catch (error) {
      return {
        valid: false,
        errors: [{
          instancePath: '$',
          keyword: 'schema',
          message: error instanceof Error ? error.message : String(error),
          params: {},
        }],
      };
    }

    if (compiled(instance)) return { valid: true, errors: [] };
    return { valid: false, errors: (compiled.errors ?? []).map(normalizeError) };
  }

  async validateAsync(schema: unknown, instance: unknown, options: InstanceValidationOptions): Promise<InstanceValidationReport> {
    try {
      const resolver = options.schemaResolver ?? this.#schemaResolver;
      const context = { documentPath: options.documentPath, rootSchema: schema, schemaRoots: options.schemaRoots ?? [] };
      const ajv = this.#createAjv(resolver.createLoadSchema(context));
      await resolver.register(ajv, context);
      const compiled = await ajv.compileAsync(schema as Record<string, unknown>);
      if (compiled(instance)) return { valid: true, errors: [] };
      return { valid: false, errors: (compiled.errors ?? []).map(normalizeError) };
    } catch (error) {
      return {
        valid: false,
        errors: [{
          instancePath: '$',
          keyword: 'schema',
          message: error instanceof Error ? error.message : String(error),
          params: {},
        }],
      };
    }
  }

  #createAjv(loadSchema?: (uri: string) => Promise<Record<string, unknown>>): Ajv2020 {
    return new Ajv2020({
      allErrors: true,
      strict: false,
      validateSchema: true,
      ...(loadSchema ? { loadSchema } : {}),
    });
  }
}

export function validateInstance(schema: unknown, instance: unknown, options: InstanceValidationOptions): InstanceValidationReport {
  return new SchemaInstanceValidator({ schemaResolver: options.schemaResolver }).validate(schema, instance, options);
}

export async function validateInstanceAsync(schema: unknown, instance: unknown, options: InstanceValidationOptions): Promise<InstanceValidationReport> {
  return new SchemaInstanceValidator().validateAsync(schema, instance, options);
}