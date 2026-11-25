import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { Ajv2020, type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js';
import { getDefaultCachedRegistrySchemaResolver } from './cached-registry-schema-resolver.js';
import { schemaRules } from './rules/index.js';
import type { SchemaResolver } from './resolver-contract.js';
import { isSchemaObject, type SchemaFinding, type SchemaRule, type ValidationReport } from './types.js';

export type { ValidationReport } from './types.js';

const DIALECT = 'https://json-schema.org/draft/2020-12/schema';

export interface SchemaValidatorOptions {
  readonly rules?: readonly SchemaRule[];
  readonly schemaRoots?: readonly string[];
  readonly schemaResolver?: SchemaResolver;
}

export interface ValidateSchemaOptions extends SchemaValidatorOptions {
  /** Path included in the report and used as the base for local references. */
  readonly documentPath?: string;
}

function ajvMessage(errors: readonly ErrorObject[] | null | undefined): string {
  const error = errors?.[0];
  return error ? `${error.instancePath || '$'} ${error.message ?? 'is invalid'}` : 'JSON Schema meta-schema validation failed.';
}

function parserFinding(path: string, message: string, code = 'INVALID_JSON'): SchemaFinding {
  return { code, rule: 'schema-parser', path, message, severity: 'error' };
}

export class SchemaValidator {
  readonly #rules: readonly SchemaRule[];
  readonly #schemaRoots: readonly string[];
  readonly #schemaResolver: SchemaResolver;

  constructor(options: SchemaValidatorOptions = {}) {
    this.#rules = options.rules ?? schemaRules;
    this.#schemaRoots = options.schemaRoots ?? [];
    this.#schemaResolver = options.schemaResolver ?? getDefaultCachedRegistrySchemaResolver();
  }

  validate(documentPath: string, schema: unknown): ValidationReport {
    if (!isSchemaObject(schema)) return { path: documentPath, valid: false, findings: [parserFinding('$', 'The document must contain a JSON object representing a schema.', 'ROOT_NOT_OBJECT')] };

    const findings: SchemaFinding[] = [];
    const ajv = this.#createAjv();
    if (!ajv.validateSchema(schema)) findings.push(parserFinding('$', ajvMessage(ajv.errors), 'SCHEMA_META_INVALID'));
    let compiled: ValidateFunction | undefined;
    try {
      this.#schemaResolver.registerSync(ajv, { documentPath, rootSchema: schema, schemaRoots: this.#schemaRoots });
      compiled = ajv.compile(schema);
    } catch (error) {
      findings.push(parserFinding('$', `Schema cannot be compiled: ${error instanceof Error ? error.message : String(error)}`, 'SCHEMA_COMPILE_ERROR'));
    }
    findings.push(...this.#checkExamples(schema, documentPath, ajv, compiled));
    return { path: documentPath, valid: findings.length === 0, findings };
  }

  async validateAsync(documentPath: string, schema: unknown): Promise<ValidationReport> {
    if (!isSchemaObject(schema)) return { path: documentPath, valid: false, findings: [parserFinding('$', 'The document must contain a JSON object representing a schema.', 'ROOT_NOT_OBJECT')] };

    const findings: SchemaFinding[] = [];
    const resolverContext = { documentPath, rootSchema: schema, schemaRoots: this.#schemaRoots };
    const ajv = this.#createAjv(this.#schemaResolver.createLoadSchema(resolverContext));
    if (!ajv.validateSchema(schema)) findings.push(parserFinding('$', ajvMessage(ajv.errors), 'SCHEMA_META_INVALID'));
    let compiled: ValidateFunction | undefined;
    try {
      await this.#schemaResolver.register(ajv, resolverContext);
      compiled = await ajv.compileAsync(schema);
    } catch (error) {
      findings.push(parserFinding('$', `Schema cannot be compiled: ${error instanceof Error ? error.message : String(error)}`, 'SCHEMA_COMPILE_ERROR'));
    }
    findings.push(...this.#checkExamples(schema, documentPath, ajv, compiled));
    return { path: documentPath, valid: findings.length === 0, findings };
  }

  async validateFile(documentPath: string): Promise<ValidationReport> {
    let raw: string;
    try {
      raw = await readFile(documentPath, 'utf8');
    } catch (error) {
      return { path: documentPath, valid: false, findings: [parserFinding(documentPath, `Cannot read file: ${error instanceof Error ? error.message : String(error)}`, 'FILE_READ_ERROR')] };
    }
    let schema: unknown;
    try {
      schema = JSON.parse(raw) as unknown;
    } catch (error) {
      return { path: documentPath, valid: false, findings: [parserFinding(documentPath, `Invalid JSON: ${error instanceof Error ? error.message : String(error)}`)] };
    }
    return this.validateAsync(documentPath, schema);
  }

  #checkExamples(schema: Record<string, unknown>, documentPath: string, ajv: Ajv2020, compiled?: ValidateFunction): SchemaFinding[] {
    const findings: SchemaFinding[] = [];
    if (compiled && Array.isArray(schema.examples)) {
      schema.examples.forEach((example, index) => {
        if (!compiled(example)) findings.push(parserFinding(`$.examples[${index}]`, `Document example does not validate: ${ajvMessage(compiled.errors)}`, 'ROOT_EXAMPLE_INVALID'));
      });
    }

    let exampleSchemaCounter = 0;
    const validateInstance = (instance: unknown, childSchema: unknown): readonly string[] => {
      const exampleId = pathToFileURL(documentPath).href;
      try {
        if (childSchema === schema && compiled) {
          if (compiled(instance)) return [];
          return (compiled.errors ?? []).map((item) => `${item.instancePath || '$'} ${item.message ?? 'is invalid'}`);
        }
        const scopedChildSchema = isSchemaObject(childSchema)
          ? {
            ...childSchema,
            ...(this.#schemaRoots.length > 0 ? { $id: `${exampleId}?example=${exampleSchemaCounter++}` } : {}),
            ...(isSchemaObject(schema.$defs) || isSchemaObject(childSchema.$defs)
              ? { $defs: { ...(isSchemaObject(schema.$defs) ? schema.$defs : {}), ...(isSchemaObject(childSchema.$defs) ? childSchema.$defs : {}) } }
              : {}),
          }
          : childSchema;
        const childValidator = ajv.compile(scopedChildSchema as Record<string, unknown>);
        if (childValidator(instance)) return [];
        return (childValidator.errors ?? []).map((item) => `${item.instancePath || '$'} ${item.message ?? 'is invalid'}`);
      } catch (error) {
        return [`could not compile example subschema: ${error instanceof Error ? error.message : String(error)}`];
      }
    };
    for (const rule of this.#rules) findings.push(...rule.check({ schema, documentPath, validateInstance }));
    return findings;
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

/**
 * Validate JSON Schema content without first writing it to a file. JSON text is
 * parsed as a document; already-parsed values are validated directly.
 */
export function validateSchema(content: unknown, options: ValidateSchemaOptions = {}): ValidationReport {
  const documentPath = options.documentPath ?? '<content>';
  let schema = content;
  if (typeof content === 'string') {
    try {
      schema = JSON.parse(content) as unknown;
    } catch (error) {
      return {
        path: documentPath,
        valid: false,
        findings: [{
          code: 'INVALID_JSON',
          rule: 'schema-parser',
          path: documentPath,
          message: `Invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
          severity: 'error',
        }],
      };
    }
  }

  const { documentPath: _documentPath, ...validatorOptions } = options;
  return new SchemaValidator(validatorOptions).validate(documentPath, schema);
}

export { DIALECT };