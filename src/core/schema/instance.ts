import { Ajv2020, type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js';
import { LocalSchemaResolver } from './resolver.js';

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

export interface AsyncInstanceValidationOptions {
  readonly documentPath: string;
  readonly schemaRoot?: string;
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
  readonly #ajv: Ajv2020;

  constructor() {
    this.#ajv = new Ajv2020({ allErrors: true, strict: false, validateSchema: true });
  }

  validate(schema: unknown, instance: unknown): InstanceValidationReport {
    let compiled: ValidateFunction;
    try {
      compiled = this.#ajv.compile(schema as Record<string, unknown>);
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

  async validateAsync(schema: unknown, instance: unknown, options: AsyncInstanceValidationOptions): Promise<InstanceValidationReport> {
    try {
      const resolver = new LocalSchemaResolver({ documentPath: options.documentPath, rootSchema: schema, schemaRoot: options.schemaRoot });
      const ajv = new Ajv2020({
        allErrors: true,
        strict: false,
        validateSchema: true,
        loadSchema: (uri) => resolver.load(uri),
      });
      await resolver.registerWith(ajv);
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
}

export function validateInstance(schema: unknown, instance: unknown): InstanceValidationReport {
  return new SchemaInstanceValidator().validate(schema, instance);
}

export async function validateInstanceAsync(schema: unknown, instance: unknown, options: AsyncInstanceValidationOptions): Promise<InstanceValidationReport> {
  return new SchemaInstanceValidator().validateAsync(schema, instance, options);
}