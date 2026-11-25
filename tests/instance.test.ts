import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateInstance, validateInstanceAsync } from '../src/core/schema/instance.js';
import type { SchemaResolver } from '../src/core/schema/resolver-contract.js';

describe('instance validation API', () => {
  const schema = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://example.com/instance-test',
    type: 'object',
    additionalProperties: false,
    required: ['name'],
    properties: {
      name: { type: 'string' },
    },
  };

  it('accepts a custom resolver interface for synchronous and asynchronous instance validation', async () => {
    const childSchema = {
      $id: 'https://schemas.example.test/instance/custom-child',
      type: 'string',
    };
    const rootSchema = {
      $id: 'https://schemas.example.test/instance/custom-root',
      type: 'object',
      properties: { child: { $ref: childSchema.$id } },
      required: ['child'],
      additionalProperties: false,
    };
    const calls: string[] = [];
    const customResolver: SchemaResolver = {
      registerSync: (ajv, context) => {
        calls.push(`sync:${context.documentPath}`);
        ajv.addSchema(childSchema);
      },
      register: async (_ajv, context) => {
        calls.push(`async:${context.documentPath}`);
      },
      createLoadSchema: (context) => async () => {
        calls.push(`load:${context.documentPath}`);
        return childSchema;
      },
    };
    const options = {
      documentPath: '/custom/instance.schema.json',
      schemaRoots: ['/custom/root'],
      schemaResolver: customResolver,
    };

    expect(validateInstance(rootSchema, { child: 'ok' }, options)).toEqual({ valid: true, errors: [] });
    await expect(validateInstanceAsync(rootSchema, { child: 'ok' }, options)).resolves.toEqual({ valid: true, errors: [] });
    expect(calls).toEqual([
      'sync:/custom/instance.schema.json',
      'async:/custom/instance.schema.json',
      'load:/custom/instance.schema.json',
    ]);
  });

  it('validates a compatible instance', () => {
    expect(validateInstance(schema, { name: 'valid' })).toEqual({ valid: true, errors: [] });
  });

  it('returns structured errors for an invalid instance', () => {
    const result = validateInstance(schema, { name: 42 });
    expect(result.valid).toBe(false);
    expect(result.errors[0]?.instancePath).toBe('/name');
  });

  it('validates instances against an external local reference asynchronously', async () => {
    const root = await mkdtemp(join(tmpdir(), 'instance-external-'));
    const schemas = join(root, 'schemas');
    await mkdir(schemas, { recursive: true });
    await writeFile(join(schemas, 'child.json'), JSON.stringify({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $id: 'https://example.com/instance-child.json',
      type: 'string', description: 'A child value.', examples: ['valid'],
    }), 'utf8');
    const schemaPath = join(schemas, 'root.json');
    const schema = {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $id: 'https://example.com/instance-root.json',
      type: 'object', properties: { child: { $ref: './child.json' } },
      required: ['child'], additionalProperties: false,
    };
    await writeFile(schemaPath, JSON.stringify(schema), 'utf8');

    await expect(validateInstanceAsync(schema, { child: 'valid' }, { documentPath: schemaPath })).resolves.toEqual({ valid: true, errors: [] });
    const invalid = await validateInstanceAsync(schema, { child: 42 }, { documentPath: schemaPath });
    expect(invalid.valid).toBe(false);
    expect(invalid.errors[0]?.instancePath).toBe('/child');
  });

  it('enforces the explicit schema root for nested instance references', async () => {
    const root = await mkdtemp(join(tmpdir(), 'instance-nested-'));
    const schemaRoot = join(root, 'schemas');
    const familyDirectory = join(schemaRoot, 'family', 'v1');
    const commonDirectory = join(schemaRoot, 'common', 'v1');
    await mkdir(familyDirectory, { recursive: true });
    await mkdir(commonDirectory, { recursive: true });
    await writeFile(join(commonDirectory, 'child.json'), JSON.stringify({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $id: 'https://example.com/common/child', type: 'string', description: 'A nested child value.', examples: ['valid'],
    }), 'utf8');
    const schemaPath = join(familyDirectory, 'root.json');
    const schema = {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $id: 'https://example.com/family/root', type: 'object', properties: { child: { $ref: '../../common/v1/child.json' } },
      required: ['child'], additionalProperties: false,
    };
    await writeFile(schemaPath, JSON.stringify(schema), 'utf8');

    await expect(validateInstanceAsync(schema, { child: 'valid' }, { documentPath: schemaPath, schemaRoots: [schemaRoot] })).resolves.toEqual({ valid: true, errors: [] });
    const invalid = await validateInstanceAsync(schema, { child: 42 }, { documentPath: schemaPath, schemaRoots: [schemaRoot] });
    expect(invalid.valid).toBe(false);
    expect(invalid.errors[0]?.instancePath).toBe('/child');
  });

});
