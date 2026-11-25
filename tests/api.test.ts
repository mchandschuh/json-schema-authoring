import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { findSchema, loadSchema, validateSchema } from '../src/index.js';
import { SchemaRegistryConfiguration } from '../src/core/schema/registry.js';
import type { SchemaResolver } from '../src/core/schema/resolver-contract.js';
import type { SchemaRule } from '../src/core/schema/types.js';

const schema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://schemas.example.test/api/v1/item',
  title: 'Item',
  description: 'An API test item.',
  type: 'object',
  properties: {
    name: { type: 'string', description: 'The item name.', examples: ['widget'] },
  },
  required: ['name'],
  additionalProperties: false,
  examples: [{ name: 'widget' }],
};

describe('schema convenience API', () => {
  it('loads a local schema from a path and a file URI', async () => {
    const root = await mkdtemp(join(tmpdir(), 'schema-api-load-'));
    const path = join(root, 'schema.json');
    await writeFile(path, JSON.stringify(schema), 'utf8');

    await expect(loadSchema(path)).resolves.toEqual(schema);
    await expect(loadSchema(pathToFileURL(path).href)).resolves.toEqual(schema);
  });

  it('uses baseDirectory for relative schema paths', async () => {
    const root = await mkdtemp(join(tmpdir(), 'schema-api-base-'));
    const directory = join(root, 'nested');
    const path = join(directory, 'schema.json');
    await mkdir(directory, { recursive: true });
    await writeFile(path, JSON.stringify(schema), 'utf8');

    await expect(loadSchema('nested/schema.json', { baseDirectory: root })).resolves.toEqual(schema);
  });

  it('uses documentPath for relative references and rootSchema for root identifiers', async () => {
    const root = await mkdtemp(join(tmpdir(), 'schema-api-context-'));
    const rootPath = join(root, 'root.schema.json');
    const childPath = join(root, 'child.schema.json');
    const rootSchema = {
      ...schema,
      $id: 'https://schemas.example.test/api/v1/root',
    };
    await writeFile(rootPath, JSON.stringify(rootSchema), 'utf8');
    await writeFile(childPath, JSON.stringify(schema), 'utf8');

    await expect(loadSchema('./child.schema.json', { documentPath: rootPath })).resolves.toEqual(schema);
    await expect(loadSchema(rootSchema.$id, { documentPath: rootPath, rootSchema })).resolves.toEqual(rootSchema);
  });

  it('indexes schemaRoot and schemaRoots for absolute schema identifiers', async () => {
    const root = await mkdtemp(join(tmpdir(), 'schema-api-roots-'));
    const first = join(root, 'first');
    const second = join(root, 'second');
    const firstSchema = { ...schema, $id: 'https://schemas.example.test/api/v1/first' };
    const secondSchema = { ...schema, $id: 'https://schemas.example.test/api/v1/second' };
    await mkdir(first, { recursive: true });
    await mkdir(second, { recursive: true });
    await writeFile(join(first, 'first.schema.json'), JSON.stringify(firstSchema), 'utf8');
    await writeFile(join(second, 'second.schema.json'), JSON.stringify(secondSchema), 'utf8');
    const documentPath = join(root, 'requesting.schema.json');

    await expect(loadSchema(firstSchema.$id, { schemaRoot: first })).resolves.toEqual(firstSchema);
    await expect(loadSchema(secondSchema.$id, { documentPath, schemaRoots: [first, second] })).resolves.toEqual(secondSchema);
  });

  it('reports invalid load inputs and never retrieves network schemas', async () => {
    const root = await mkdtemp(join(tmpdir(), 'schema-api-load-errors-'));
    const malformedPath = join(root, 'malformed.json');
    const arrayPath = join(root, 'array.json');
    await writeFile(malformedPath, '{"type":', 'utf8');
    await writeFile(arrayPath, '[]', 'utf8');

    await expect(loadSchema('')).rejects.toThrow('A schema URI is required.');
    await expect(loadSchema('https://schemas.example.test/missing')).rejects.toThrow('Network schema resolution is disabled');
    await expect(loadSchema(malformedPath)).rejects.toThrow('is not valid JSON');
    await expect(loadSchema(arrayPath)).rejects.toThrow('must be a JSON object');
  });

  it('finds a schema from object options', async () => {
    const root = await mkdtemp(join(tmpdir(), 'schema-api-find-'));
    const app = join(root, 'app');
    const home = join(root, 'home');
    const schemas = join(root, 'schemas');
    await mkdir(schemas, { recursive: true });
    const path = join(schemas, 'item.schema.json');
    await writeFile(path, JSON.stringify(schema), 'utf8');
    const configuration = new SchemaRegistryConfiguration({ cwd: app, homeDirectory: home, environment: {} });
    await configuration.add(schemas, 'home');

    await expect(findSchema({ schemaType: 'item', configuration })).resolves.toMatchObject({ id: schema.$id, path, schema });
    await expect(findSchema({ schemaUri: schema.$id, configuration })).resolves.toMatchObject({ path });
  });

  it('supports all findSchema search aliases and type/version options', async () => {
    const root = await mkdtemp(join(tmpdir(), 'schema-api-find-options-'));
    const app = join(root, 'app');
    const home = join(root, 'home');
    const schemas = join(root, 'schemas');
    const versionedSchema = { ...schema, $id: 'https://schemas.example.test/task/v1' };
    const path = join(schemas, 'task.schema.json');
    await mkdir(schemas, { recursive: true });
    await writeFile(path, JSON.stringify(versionedSchema), 'utf8');
    const configuration = new SchemaRegistryConfiguration({ cwd: app, homeDirectory: home, environment: {} });
    await configuration.add(schemas, 'home');

    const selectors = [
      { searchString: 'task/v1' },
      { search: 'task/v1' },
      { schemaUri: versionedSchema.$id },
      { schemaType: 'task', version: 1 },
      { type: 'task', version: 'v1' },
      { schemaType: 'task' },
    ];
    for (const selector of selectors) {
      await expect(findSchema({ ...selector, configuration })).resolves.toMatchObject({ id: versionedSchema.$id, path });
    }
    await expect(findSchema('task/v1', { configuration })).resolves.toMatchObject({ id: versionedSchema.$id, path });
  });

  it('rejects findSchema calls without a selector or with no match', async () => {
    const root = await mkdtemp(join(tmpdir(), 'schema-api-find-errors-'));
    const configuration = new SchemaRegistryConfiguration({ cwd: join(root, 'app'), homeDirectory: join(root, 'home'), environment: {} });

    await expect(findSchema({ configuration })).rejects.toThrow('requires a searchString');
    await expect(findSchema({ searchString: '   ', configuration })).rejects.toThrow('A schema type is required');
    await expect(findSchema({ search: 'missing', configuration })).rejects.toThrow('No registered schema matches: missing');
  });

  it('validates JSON text and parsed content', () => {
    expect(validateSchema(JSON.stringify(schema))).toMatchObject({ path: '<content>', valid: true, findings: [] });
    expect(validateSchema({ ...schema, examples: [{ name: 42 }] }).findings.map((finding) => finding.code)).toContain('ROOT_EXAMPLE_INVALID');
    expect(validateSchema('{"type":').findings[0]?.code).toBe('INVALID_JSON');
  });

  it('passes a custom resolver interface through validateSchema', () => {
    const childSchema = { $id: 'https://schemas.example.test/api/custom-child', type: 'string' };
    const rootSchema = {
      $id: 'https://schemas.example.test/api/custom-root',
      type: 'object',
      properties: { child: { $ref: childSchema.$id } },
      required: ['child'],
      additionalProperties: false,
    };
    let registered = false;
    const resolver: SchemaResolver = {
      registerSync: (ajv) => {
        registered = true;
        ajv.addSchema(childSchema);
      },
      register: async () => undefined,
      createLoadSchema: async () => childSchema,
    };

    const report = validateSchema(rootSchema, { documentPath: '/api/root.schema.json', schemaResolver: resolver, rules: [] });
    expect(report).toEqual({ path: '/api/root.schema.json', valid: true, findings: [] });
    expect(registered).toBe(true);
  });

  it('applies documentPath, schema roots, and custom rules to validation', () => {
    const documentPath = '/tmp/schema-api-content/root.schema.json';
    const customRule: SchemaRule = {
      id: 'api-test-rule',
      description: 'Add a finding for API option coverage.',
      check: () => [{
        code: 'API_TEST_FINDING',
        rule: 'api-test-rule',
        path: '$',
        message: 'The API test rule ran.',
        severity: 'error',
      }],
    };

    const report = validateSchema(JSON.stringify(schema), {
      documentPath,
      schemaRoots: ['/tmp/schema-api-content', '/tmp/schema-api-other'],
      rules: [customRule],
    });
    expect(report.path).toBe(documentPath);
    expect(report.valid).toBe(false);
    expect(report.findings).toEqual([{
      code: 'API_TEST_FINDING',
      rule: 'api-test-rule',
      path: '$',
      message: 'The API test rule ran.',
      severity: 'error',
    }]);

    expect(validateSchema({ type: 'string' }, { documentPath, rules: [] })).toEqual({
      path: documentPath,
      valid: true,
      findings: [],
    });
  });
});