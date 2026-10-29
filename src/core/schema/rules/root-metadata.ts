import { finding, isNonEmptyString, isSchemaObject, type SchemaRule } from '../types.js';

const DRAFT_2020_12 = 'https://json-schema.org/draft/2020-12/schema';
const ROOT_TYPES = new Set(['array', 'boolean', 'integer', 'null', 'number', 'object', 'string']);

export const rootMetadataRule: SchemaRule = {
  id: 'root-metadata',
  description: 'Require a self-describing JSON Schema 2020-12 root document.',
  check: ({ schema }) => {
    const findings = [];
    if (!isSchemaObject(schema)) {
      findings.push(finding(rootMetadataRule, 'ROOT_NOT_OBJECT', '$', 'The schema document must be a JSON object.'));
      return findings;
    }
    if (schema.$schema !== DRAFT_2020_12) findings.push(finding(rootMetadataRule, 'MISSING_DIALECT', '$.$schema', `Set $schema to ${DRAFT_2020_12}.`));
    if (!isNonEmptyString(schema.$id) || !/^[A-Za-z][A-Za-z0-9+.-]*:\S*$/.test(schema.$id)) {
      findings.push(finding(rootMetadataRule, 'INVALID_ID', '$.$id', 'Set $id to a non-empty absolute URI (for example, https://example.com/schemas/user).'));
    }
    if (!isNonEmptyString(schema.title)) findings.push(finding(rootMetadataRule, 'MISSING_TITLE', '$.title', 'Add a concise, human-readable title.'));
    if (!isNonEmptyString(schema.description)) findings.push(finding(rootMetadataRule, 'MISSING_DESCRIPTION', '$.description', 'Add a useful root description explaining the document purpose.'));
    if (!Array.isArray(schema.examples) || schema.examples.length === 0) findings.push(finding(rootMetadataRule, 'MISSING_EXAMPLES', '$.examples', 'Add at least one complete document example.'));
    if (typeof schema.type !== 'string' || !ROOT_TYPES.has(schema.type)) findings.push(finding(rootMetadataRule, 'ROOT_INVALID_TYPE', '$.type', 'Schema documents must declare one supported JSON Schema root type: array, boolean, integer, null, number, object, or string.'));
    return findings;
  },
};
