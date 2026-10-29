import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SchemaValidator } from '../src/core/schema/validator.js';

const fixture = async (content: string): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'schema-validate-'));
  await mkdir(join(root, 'schemas'), { recursive: true });
  const path = join(root, 'schemas', 'fixture.json');
  await writeFile(path, content, 'utf8');
  return path;
};

const externalFixtures = async (): Promise<{ schemaPath: string }> => {
  const root = await mkdtemp(join(tmpdir(), 'schema-external-'));
  const schemas = join(root, 'schemas');
  await mkdir(schemas, { recursive: true });
  await writeFile(join(schemas, 'grandchild.schema.json'), JSON.stringify({
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://example.com/grandchild.schema.json',
    $defs: { Grandchild: { $anchor: 'Grandchild', type: 'string', description: 'A grandchild value.', examples: ['leaf'] } },
  }), 'utf8');
  await writeFile(join(schemas, 'child.schema.json'), JSON.stringify({
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://example.com/child.schema.json',
    $defs: {
      Child: {
        type: 'object', description: 'A child object.', examples: [{ name: 'widget', leaf: 'leaf' }],
        properties: {
          name: { type: 'string', description: 'Child name.', examples: ['widget'] },
          leaf: { $ref: './grandchild.schema.json#Grandchild', description: 'Child leaf.', examples: ['leaf'] },
        },
        required: ['name', 'leaf'], additionalProperties: false,
      },
    },
  }), 'utf8');
  const schemaPath = join(schemas, 'root.schema.json');
  await writeFile(schemaPath, JSON.stringify({
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://example.com/root.schema.json', title: 'Root', description: 'A root object.', type: 'object',
    properties: {
      child: { $ref: './child.schema.json#/$defs/Child', description: 'The child object.', examples: [{ name: 'widget', leaf: 'leaf' }] },
      absoluteChild: { $ref: 'https://example.com/child.schema.json#/$defs/Child', description: 'The same child through its absolute identifier.', examples: [{ name: 'widget', leaf: 'leaf' }] },
    },
    required: ['child', 'absoluteChild'], additionalProperties: false,
    examples: [{ child: { name: 'widget', leaf: 'leaf' }, absoluteChild: { name: 'widget', leaf: 'leaf' } }],
  }), 'utf8');
  return { schemaPath };
};

describe('SchemaValidator', () => {
  it('validates a complete schema file', async () => {
    const path = await fixture(JSON.stringify({
      $schema: 'https://json-schema.org/draft/2020-12/schema', $id: 'https://example.com/user', title: 'User', description: 'A user.', type: 'object',
      properties: { userName: { type: 'string', description: 'Name.', examples: ['ada'] } }, required: ['userName'], additionalProperties: false, examples: [{ userName: 'ada' }],
    }));
    const report = await new SchemaValidator().validateFile(path);
    expect(report.valid).toBe(true);
    expect(report.findings).toEqual([]);
  });

  it('validates a documented primitive value schema', async () => {
    const path = await fixture(JSON.stringify({
      $schema: 'https://json-schema.org/draft/2020-12/schema', $id: 'https://example.com/step-id', title: 'Step ID',
      description: 'A numeric step identifier.', type: 'string', pattern: '^[0-9]{2,8}$', examples: ['05'],
    }));
    const report = await new SchemaValidator().validateFile(path);
    expect(report.valid).toBe(true);
    expect(report.findings).toEqual([]);
  });

  it('requires schema-valued fields to use absolute URI references', async () => {
    const path = await fixture(JSON.stringify({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $id: 'https://example.com/schema-reference-fixture',
      title: 'Schema reference fixture',
      description: 'A schema containing application-level schema references.',
      type: 'object',
      properties: {
        schema: {
          type: 'string',
          const: 'sdlc-work-item/v2',
          description: 'The instance schema identifier.',
          examples: ['sdlc-work-item/v2'],
        },
        taskSchema: {
          type: 'string',
          description: 'The selected task schema.',
          examples: ['https://schemas.example.test/task/v1'],
        },
        description: {
          type: 'string',
          description: 'An ordinary string that may contain a compact-looking value.',
          examples: ['sdlc-work-item/v2'],
        },
      },
      required: ['schema', 'taskSchema', 'description'],
      additionalProperties: false,
      examples: [{ schema: 'sdlc-work-item/v2', taskSchema: 'https://schemas.example.test/task/v1', description: 'sdlc-work-item/v2' }],
    }));

    const report = await new SchemaValidator().validateFile(path);
    expect(report.valid).toBe(false);
    expect(report.findings.filter((item) => item.rule === 'schema-references').map((item) => item.path)).toEqual([
      '$.properties.schema.const',
      '$.properties.schema.examples[0]',
    ]);
    expect(report.findings.some((item) => item.path === '$.properties.description.examples[0]')).toBe(false);
  });

  it('accepts absolute schema URI references with fragments', async () => {
    const path = await fixture(JSON.stringify({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $id: 'https://example.com/schema-reference-fragment-fixture',
      title: 'Schema reference fragment fixture',
      description: 'A schema containing a URI reference to a subschema.',
      type: 'object',
      properties: {
        resultSchema: {
          type: 'string',
          pattern: '^https://schemas\\.handschuh\\.dev/sdlc/[a-z][a-z0-9-]*/v[1-9][0-9]*(?:#.*)?$',
          description: 'The result subschema URI.',
          examples: ['https://schemas.handschuh.dev/sdlc/task-design/v1#/properties/result'],
        },
      },
      required: ['resultSchema'],
      additionalProperties: false,
      examples: [{ resultSchema: 'https://schemas.handschuh.dev/sdlc/task-design/v1#/properties/result' }],
    }));

    const report = await new SchemaValidator().validateFile(path);
    expect(report.valid).toBe(true);
    expect(report.findings).toEqual([]);
  });

  it('resolves local definitions while validating nested field examples', async () => {
    const path = await fixture(JSON.stringify({
      $schema: 'https://json-schema.org/draft/2020-12/schema', $id: 'https://example.com/catalog', title: 'Catalog',
      description: 'A catalog with reusable item definitions.', type: 'object',
      properties: {
        items: {
          type: 'array', description: 'Catalog items.', examples: [[{ name: 'widget' }]],
          items: { $ref: '#/$defs/Item' },
        },
      },
      required: ['items'], additionalProperties: false, examples: [{ items: [{ name: 'widget' }] }],
      $defs: {
        Item: {
          type: 'object', description: 'One catalog item.', examples: [{ name: 'widget' }],
          properties: { name: { type: 'string', description: 'Item name.', examples: ['widget'] } },
          required: ['name'], additionalProperties: false,
        },
      },
    }));
    const report = await new SchemaValidator().validateFile(path);
    expect(report.valid).toBe(true);
    expect(report.findings).toEqual([]);
  });

  it('reports malformed JSON and unreadable files without throwing', async () => {
    const bad = await fixture('{"type":');
    expect((await new SchemaValidator().validateFile(bad)).findings[0]?.code).toBe('INVALID_JSON');
    expect((await new SchemaValidator().validateFile('/does/not/exist.json')).findings[0]?.code).toBe('FILE_READ_ERROR');
  });

  it('reports invalid root examples using the JSON Schema validator', async () => {
    const path = await fixture(JSON.stringify({
      $schema: 'https://json-schema.org/draft/2020-12/schema', $id: 'https://example.com/user', title: 'User', description: 'A user.', type: 'object',
      properties: { userName: { type: 'string', description: 'Name.', examples: ['ada'] } }, required: ['userName'], additionalProperties: false, examples: [{ userName: 4 }],
    }));
    const report = await new SchemaValidator().validateFile(path);
    expect(report.findings.map((item) => item.code)).toContain('ROOT_EXAMPLE_INVALID');
  });

  it('resolves nested relative, fragment, anchor, and absolute-id references', async () => {
    const { schemaPath } = await externalFixtures();
    const report = await new SchemaValidator().validateFile(schemaPath);
    expect(report.valid).toBe(true);
    expect(report.findings).toEqual([]);

    const invalidPath = join(schemaPath, '..', 'invalid-root.schema.json');
    const invalidRoot = JSON.parse(await readFile(schemaPath, 'utf8')) as Record<string, unknown>;
    invalidRoot.examples = [{ child: { name: 42, leaf: 'leaf' } }];
    await writeFile(invalidPath, JSON.stringify(invalidRoot), 'utf8');
    const invalid = await new SchemaValidator().validateFile(invalidPath);
    expect(invalid.findings.map((item) => item.code)).toContain('ROOT_EXAMPLE_INVALID');
  });

  it('reports missing and malformed external schemas as compile findings', async () => {
    const root = await mkdtemp(join(tmpdir(), 'schema-failure-'));
    const missingPath = join(root, 'missing-root.json');
    await writeFile(missingPath, JSON.stringify({
      $schema: 'https://json-schema.org/draft/2020-12/schema', $id: 'https://example.com/missing-root.json',
      title: 'Missing root', description: 'A root with a missing child.', type: 'object',
      properties: { child: { $ref: './missing-child.json', description: 'Missing child.', examples: [{}] } },
      required: ['child'], additionalProperties: false, examples: [{ child: {} }],
    }), 'utf8');
    const missing = await new SchemaValidator().validateFile(missingPath);
    expect(missing.findings.map((item) => item.code)).toContain('SCHEMA_COMPILE_ERROR');

    const malformedPath = join(root, 'malformed-root.json');
    await writeFile(join(root, 'malformed-child.json'), '{"type":', 'utf8');
    await writeFile(malformedPath, JSON.stringify({
      $schema: 'https://json-schema.org/draft/2020-12/schema', $id: 'https://example.com/malformed-root.json',
      title: 'Malformed root', description: 'A root with a malformed child.', type: 'object',
      properties: { child: { $ref: './malformed-child.json', description: 'Malformed child.', examples: [{}] } },
      required: ['child'], additionalProperties: false, examples: [{ child: {} }],
    }), 'utf8');
    const malformed = await new SchemaValidator().validateFile(malformedPath);
    expect(malformed.findings.map((item) => item.code)).toContain('SCHEMA_COMPILE_ERROR');
  });

  it('resolves a nested cross-family reference within an explicit schema root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'schema-nested-'));
    const schemaRoot = join(root, 'schemas');
    const familyDirectory = join(schemaRoot, 'task', 'v1');
    const commonDirectory = join(schemaRoot, 'common', 'v1');
    await mkdir(familyDirectory, { recursive: true });
    await mkdir(commonDirectory, { recursive: true });
    await writeFile(join(commonDirectory, 'identifier.schema.json'), JSON.stringify({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $id: 'https://example.com/common/v1/identifier',
      title: 'Identifier', description: 'A nested common identifier.', type: 'string',
      pattern: '^[A-Z]+-[0-9]+$', examples: ['TASK-001'],
    }), 'utf8');
    const schemaPath = join(familyDirectory, 'task.schema.json');
    await writeFile(schemaPath, JSON.stringify({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $id: 'https://example.com/task/v1', title: 'Task', description: 'A task with a common identifier.', type: 'object',
      properties: { id: { $ref: '../../common/v1/identifier.schema.json', description: 'Task identifier.', examples: ['TASK-001'] } },
      required: ['id'], additionalProperties: false, examples: [{ id: 'TASK-001' }],
    }), 'utf8');

    const report = await new SchemaValidator({ schemaRoot }).validateFile(schemaPath);
    expect(report.valid).toBe(true);
    expect(report.findings).toEqual([]);
  });

  it('rejects relative references that escape the explicit schema root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'schema-escape-'));
    const schemaRoot = join(root, 'schemas');
    const familyDirectory = join(schemaRoot, 'family', 'v1');
    await mkdir(familyDirectory, { recursive: true });
    const schemaPath = join(familyDirectory, 'root.schema.json');
    await writeFile(schemaPath, JSON.stringify({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $id: 'https://example.com/family/v1/root', title: 'Root', description: 'A root with an escaping reference.', type: 'object',
      properties: { child: { $ref: '../../../outside.schema.json', description: 'An unavailable child.', examples: ['value'] } },
      required: ['child'], additionalProperties: false, examples: [{ child: 'value' }],
    }), 'utf8');

    const report = await new SchemaValidator({ schemaRoot }).validateFile(schemaPath);
    expect(report.findings.map((item) => item.code)).toContain('SCHEMA_COMPILE_ERROR');
    expect(report.findings.some((item) => item.message.includes('escapes the schema root'))).toBe(true);
  });
});
