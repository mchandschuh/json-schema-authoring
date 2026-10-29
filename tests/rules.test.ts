import { describe, expect, it } from 'vitest';
import { examplesRule } from '../src/core/schema/rules/examples.js';
import { fieldDocumentationRule } from '../src/core/schema/rules/field-documentation.js';
import { namingRule } from '../src/core/schema/rules/naming.js';
import { objectContractRule } from '../src/core/schema/rules/object-contract.js';
import { rootMetadataRule } from '../src/core/schema/rules/root-metadata.js';
import type { SchemaRuleContext } from '../src/core/schema/types.js';

const context = (schema: unknown): SchemaRuleContext => ({ schema, documentPath: 'fixture.json' });

const validSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://example.com/schemas/user',
  title: 'User',
  description: 'A user account.',
  type: 'object',
  properties: {
    userName: { type: 'string', description: 'The public user name.', examples: ['ada'] },
    age: { type: 'integer', description: 'The user age.', examples: [37] },
  },
  required: ['userName'],
  additionalProperties: false,
  examples: [{ userName: 'ada', age: 37 }],
};

describe('root-metadata rule', () => {
  it('passes a complete root document', () => expect(rootMetadataRule.check(context(validSchema))).toEqual([]));
  it('reports every missing root contract item', () => {
    const findings = rootMetadataRule.check(context({}));
    expect(findings.map((item) => item.code)).toEqual(expect.arrayContaining(['MISSING_DIALECT', 'INVALID_ID', 'MISSING_TITLE', 'MISSING_DESCRIPTION', 'MISSING_EXAMPLES', 'ROOT_INVALID_TYPE']));
  });

  it('passes a documented primitive value schema', () => expect(rootMetadataRule.check(context({
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://example.com/schemas/step-id',
    title: 'Step ID',
    description: 'A numeric step identifier.',
    type: 'string',
    pattern: '^[0-9]{2,8}$',
    examples: ['05'],
  }))).toEqual([]));
});

describe('field-documentation rule', () => {
  it('passes documented fields and definitions', () => {
    expect(fieldDocumentationRule.check(context({ ...validSchema, $defs: { Address: { type: 'string', description: 'Address.', examples: ['one'] } } }))).toEqual([]);
  });
  it('requires descriptions and examples on fields and definitions', () => {
    const findings = fieldDocumentationRule.check(context({ properties: { userName: { type: 'string' } }, $defs: { Address: { type: 'string' } } }));
    expect(findings.map((item) => item.code)).toEqual(['FIELD_MISSING_DESCRIPTION', 'FIELD_MISSING_EXAMPLE', 'FIELD_MISSING_DESCRIPTION', 'FIELD_MISSING_EXAMPLE']);
  });
});

describe('naming rule', () => {
  it('passes lowerCamelCase fields and PascalCase definitions', () => expect(namingRule.check(context(validSchema))).toEqual([]));
  it('rejects snake_case, kebab-case, and non-Pascal definitions', () => {
    const findings = namingRule.check(context({ properties: { user_name: {}, 'display-name': {} }, $defs: { address: {}, 'User-Name': {} } }));
    expect(findings.map((item) => item.code)).toEqual(['INVALID_FIELD_NAME', 'INVALID_FIELD_NAME', 'INVALID_DEFINITION_NAME', 'INVALID_DEFINITION_NAME']);
  });
});

describe('object-contract rule', () => {
  it('passes a closed object with a valid required list', () => expect(objectContractRule.check(context(validSchema))).toEqual([]));
  it('requires closure, required declarations, and known unique required fields', () => {
    const findings = objectContractRule.check(context({ properties: { userName: {} }, required: ['missing', 'missing'] }));
    expect(findings.map((item) => item.code)).toEqual(expect.arrayContaining(['DUPLICATE_REQUIRED', 'UNKNOWN_REQUIRED', 'OPEN_OBJECT']));
  });
  it('requires required even when no required fields are mandatory', () => {
    expect(objectContractRule.check(context({ properties: { optional: {} }, additionalProperties: false })).map((item) => item.code)).toContain('MISSING_REQUIRED');
  });
});

describe('examples rule', () => {
  it('passes examples whose primitive types match', () => expect(examplesRule.check(context(validSchema))).toEqual([]));
  it('rejects examples whose primitive type does not match', () => {
    const findings = examplesRule.check(context({ ...validSchema, properties: { age: { type: 'integer', description: 'Age.', examples: ['old'] } } }));
    expect(findings.map((item) => item.code)).toContain('EXAMPLE_TYPE_MISMATCH');
  });
});
