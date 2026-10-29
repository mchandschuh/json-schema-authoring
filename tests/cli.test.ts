import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { main } from '../src/cli/main.js';

async function file(name: string, content: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'schema-cli-'));
  await mkdir(join(root, 'schemas'), { recursive: true });
  const path = join(root, 'schemas', name);
  await writeFile(path, content, 'utf8');
  return path;
}

const valid = JSON.stringify({ $schema: 'https://json-schema.org/draft/2020-12/schema', $id: 'https://example.com/user', title: 'User', description: 'A user.', type: 'object', properties: { userName: { type: 'string', description: 'Name.', examples: ['ada'] } }, required: ['userName'], additionalProperties: false, examples: [{ userName: 'ada' }] });

const instanceSchema = JSON.stringify({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://example.com/instance-root',
  type: 'object',
  additionalProperties: false,
  required: ['name', 'roles', 'summary'],
  properties: {
    name: { type: 'string', minLength: 1 },
    roles: { type: 'array', items: { type: 'string' }, minItems: 1 },
    summary: { $ref: './common/summary.json' },
  },
});

async function instanceFixture(): Promise<{ root: string; schemaPath: string; commonSchemaPath: string }> {
  const root = await mkdtemp(join(tmpdir(), 'schema-instance-cli-'));
  const common = join(root, 'common');
  await mkdir(common, { recursive: true });
  const schemaPath = join(root, 'root.schema.json');
  const commonSchemaPath = join(common, 'summary.json');
  await writeFile(schemaPath, instanceSchema, 'utf8');
  await writeFile(commonSchemaPath, JSON.stringify({
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://example.com/common/summary',
    type: 'string',
    minLength: 1,
  }), 'utf8');
  return { root, schemaPath, commonSchemaPath };
}

async function invoke(args: readonly string[]): Promise<{ exitCode: number; output: string[]; errors: string[] }> {
  const output: string[] = [];
  const errors: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (...values: unknown[]) => output.push(values.join(' '));
  console.error = (...values: unknown[]) => errors.push(values.join(' '));
  try {
    return { exitCode: await main(args), output, errors };
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
}

describe('schema-validate CLI', () => {
  it('prints actionable help', async () => {
    const output: string[] = [];
    const original = console.log;
    console.log = (...values: unknown[]) => output.push(values.join(' '));
    try {
      expect(await main(['--help'])).toBe(0);
      expect(output.join('\n')).toContain('Usage: schema-validate <schema.json> [more-schema.json ...] [options]');
      expect(output.join('\n')).toContain('Usage: schema-validate --root <directory> --schema <schema.json> --document <document.json|document.yaml>');
      expect(output.join('\n')).toContain('--json');
      expect(output.join('\n')).toContain('--root <directory>');
      expect(output.join('\n')).toContain('--document <document.json|document.yaml>');
    } finally { console.log = original; }
  });

  it('prioritizes help over incomplete instance-mode arguments', async () => {
    const result = await invoke(['--help', '--schema', 'missing.schema.json']);

    expect(result.exitCode).toBe(0);
    expect(result.output.join('\n')).toContain('Usage: schema-validate --root <directory>');
    expect(result.errors).toEqual([]);
  });

  it('validates one or more files and emits JSON output', async () => {
    const first = await file('valid.json', valid);
    const second = await file('invalid.json', '{}');
    const output: string[] = [];
    const original = console.log;
    console.log = (...values: unknown[]) => output.push(values.join(' '));
    try {
      expect(await main(['--json', first, second])).toBe(1);
      const report = JSON.parse(output.join('\n')) as { valid: boolean; reports: unknown[] };
      expect(report.valid).toBe(false);
      expect(report.reports).toHaveLength(2);
    } finally { console.log = original; }
  });

  it('returns a distinct argument error for unknown options', async () => {
    const errors: string[] = [];
    const original = console.error;
    console.error = (...values: unknown[]) => errors.push(values.join(' '));
    try {
      expect(await main(['--unknown'])).toBe(2);
      expect(errors.join('\n')).toContain('Unknown option: --unknown');
    } finally { console.error = original; }
  });

  it('validates a JSON instance and resolves a local referenced schema', async () => {
    const fixture = await instanceFixture();
    const documentPath = join(fixture.root, 'instance.json');
    await writeFile(documentPath, JSON.stringify({ name: 'Ada', roles: ['reviewer'], summary: 'A valid instance.' }), 'utf8');

    const result = await invoke(['--root', fixture.root, '--schema', fixture.schemaPath, '--document', documentPath]);

    expect(result.exitCode).toBe(0);
    expect(result.output).toEqual([`PASS ${documentPath}`]);
    expect(result.errors).toEqual([]);
  });

  it('validates an equivalent YAML instance, including YAML-native syntax', async () => {
    const fixture = await instanceFixture();
    const documentPath = join(fixture.root, 'instance.yaml');
    await writeFile(documentPath, [
      '# comments and unquoted keys are valid YAML',
      'name: Ada',
      'roles:',
      '  - reviewer',
      'summary: |',
      '  A valid instance.',
    ].join('\n'), 'utf8');

    const result = await invoke(['--root', fixture.root, '--schema', fixture.schemaPath, '--document', documentPath]);

    expect(result.exitCode).toBe(0);
    expect(result.output).toEqual([`PASS ${documentPath}`]);
    expect(result.errors).toEqual([]);
  });

  it('supports the .yml extension and emits JSON output with the detected format', async () => {
    const fixture = await instanceFixture();
    const documentPath = join(fixture.root, 'instance.yml');
    await writeFile(documentPath, 'name: Ada\nroles: [reviewer]\nsummary: Valid\n', 'utf8');

    const result = await invoke(['--json', `--root=${fixture.root}`, `--schema=${fixture.schemaPath}`, `--document=${documentPath}`]);
    const report = JSON.parse(result.output.join('\n')) as { valid: boolean; format: string; errors: unknown[] };

    expect(result.exitCode).toBe(0);
    expect(report).toMatchObject({ valid: true, schema: fixture.schemaPath, document: documentPath, format: 'yaml', errors: [] });
  });

  it('returns structured validation errors for invalid JSON and YAML instances', async () => {
    const fixture = await instanceFixture();
    const jsonPath = join(fixture.root, 'invalid.json');
    const yamlPath = join(fixture.root, 'invalid.yaml');
    await writeFile(jsonPath, JSON.stringify({ name: 42, roles: [], summary: '' }), 'utf8');
    await writeFile(yamlPath, 'name: 42\nroles: []\nsummary: ""\n', 'utf8');

    const jsonResult = await invoke(['--json', '--root', fixture.root, '--schema', fixture.schemaPath, '--document', jsonPath]);
    const yamlResult = await invoke(['--json', '--root', fixture.root, '--schema', fixture.schemaPath, '--document', yamlPath]);
    const jsonReport = JSON.parse(jsonResult.output.join('\n')) as { valid: boolean; errors: Array<{ instancePath: string; keyword: string }> };
    const yamlReport = JSON.parse(yamlResult.output.join('\n')) as { valid: boolean; errors: Array<{ instancePath: string; keyword: string }> };

    expect(jsonResult.exitCode).toBe(1);
    expect(yamlResult.exitCode).toBe(1);
    expect(jsonReport.valid).toBe(false);
    expect(yamlReport.valid).toBe(false);
    expect(jsonReport.errors.map((error) => [error.instancePath, error.keyword])).toEqual([
      ['/name', 'type'],
      ['/roles', 'minItems'],
      ['/summary', 'minLength'],
    ]);
    expect(yamlReport.errors.map((error) => [error.instancePath, error.keyword])).toEqual([
      ['/name', 'type'],
      ['/roles', 'minItems'],
      ['/summary', 'minLength'],
    ]);
  });

  it('distinguishes invalid JSON syntax from invalid YAML syntax', async () => {
    const fixture = await instanceFixture();
    const jsonPath = join(fixture.root, 'invalid.json');
    const yamlPath = join(fixture.root, 'invalid.yaml');
    await writeFile(jsonPath, '{"name":"Ada",}', 'utf8');
    await writeFile(yamlPath, 'name: Ada\nname: Grace\n', 'utf8');

    const jsonResult = await invoke(['--json', '--root', fixture.root, '--schema', fixture.schemaPath, '--document', jsonPath]);
    const yamlResult = await invoke(['--json', '--root', fixture.root, '--schema', fixture.schemaPath, '--document', yamlPath]);
    const jsonReport = JSON.parse(jsonResult.output.join('\n')) as { errors: Array<{ keyword: string; message: string }> };
    const yamlReport = JSON.parse(yamlResult.output.join('\n')) as { errors: Array<{ keyword: string; message: string }> };

    expect(jsonResult.exitCode).toBe(1);
    expect(jsonReport.errors[0]).toMatchObject({ keyword: 'document' });
    expect(jsonReport.errors[0]?.message).toMatch(/Invalid JSON/);
    expect(yamlResult.exitCode).toBe(1);
    expect(yamlReport.errors[0]).toMatchObject({ keyword: 'document' });
    expect(yamlReport.errors[0]?.message).toMatch(/Invalid YAML|unique/);
  });

  it('rejects multi-document YAML, unsupported formats, and missing documents', async () => {
    const fixture = await instanceFixture();
    const multiPath = join(fixture.root, 'multi.yaml');
    const textPath = join(fixture.root, 'instance.txt');
    await writeFile(multiPath, '---\nname: Ada\nroles: [reviewer]\nsummary: Valid\n---\nname: Grace\n', 'utf8');
    await writeFile(textPath, '{}', 'utf8');

    const multiResult = await invoke(['--json', '--root', fixture.root, '--schema', fixture.schemaPath, '--document', multiPath]);
    const textResult = await invoke(['--json', '--root', fixture.root, '--schema', fixture.schemaPath, '--document', textPath]);
    const missingResult = await invoke(['--json', '--root', fixture.root, '--schema', fixture.schemaPath, '--document', join(fixture.root, 'missing.json')]);

    expect(multiResult.exitCode).toBe(1);
    expect(JSON.parse(multiResult.output.join('\n')).errors[0]?.message).toMatch(/exactly one YAML document/i);
    expect(textResult.exitCode).toBe(1);
    expect(JSON.parse(textResult.output.join('\n')).errors[0]?.message).toMatch(/Unsupported document format/i);
    expect(missingResult.exitCode).toBe(1);
    expect(JSON.parse(missingResult.output.join('\n')).errors[0]).toMatchObject({ keyword: 'file' });
  });

  it('rejects malformed schemas before instance validation', async () => {
    const fixture = await instanceFixture();
    const badSchemaPath = join(fixture.root, 'bad.schema.json');
    const documentPath = join(fixture.root, 'instance.json');
    await writeFile(badSchemaPath, '{"type":}', 'utf8');
    await writeFile(documentPath, '{}', 'utf8');

    const result = await invoke(['--json', '--root', fixture.root, '--schema', badSchemaPath, '--document', documentPath]);
    const report = JSON.parse(result.output.join('\n')) as { errors: Array<{ keyword: string; message: string }> };

    expect(result.exitCode).toBe(1);
    expect(report.errors[0]).toMatchObject({ keyword: 'schema' });
    expect(report.errors[0]?.message).toMatch(/Invalid JSON schema/);
  });

  it('requires compatible instance-mode arguments and preserves schema-only mode', async () => {
    const fixture = await instanceFixture();
    const documentPath = join(fixture.root, 'instance.json');
    await writeFile(documentPath, '{}', 'utf8');

    await expect(invoke(['--schema', fixture.schemaPath])).resolves.toMatchObject({ exitCode: 2 });
    await expect(invoke(['--document', documentPath])).resolves.toMatchObject({ exitCode: 2 });
    await expect(invoke(['--schema', fixture.schemaPath, '--document', documentPath])).resolves.toMatchObject({ exitCode: 2 });
    await expect(invoke(['--root', fixture.root, '--schema', fixture.schemaPath, '--document', documentPath, fixture.schemaPath])).resolves.toMatchObject({ exitCode: 2 });
    await expect(invoke(['--root'])).resolves.toMatchObject({ exitCode: 2 });
    await expect(invoke(['--schema'])).resolves.toMatchObject({ exitCode: 2 });
    await expect(invoke(['--document'])).resolves.toMatchObject({ exitCode: 2 });

    const schemaOnlyPath = await file('authoring.json', valid);
    const schemaOnly = await invoke([schemaOnlyPath]);
    expect(schemaOnly.exitCode).toBe(0);
    expect(schemaOnly.output).toEqual([`PASS ${schemaOnlyPath}`]);
  });
});