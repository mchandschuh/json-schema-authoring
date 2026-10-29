import { namedFields, type SchemaNode } from '../traverse.js';
import { finding, isSchemaObject, type SchemaRule } from '../types.js';

const SCHEMA_REFERENCE_FIELD = /^(?:schema|[a-z][A-Za-z0-9]*Schema)$/;
const ABSOLUTE_URI = /^[A-Za-z][A-Za-z0-9+.-]*:[^\s]+$/;

function valuesAt(node: SchemaNode): readonly [string, unknown][] {
  const values: [string, unknown][] = [];
  if (Object.prototype.hasOwnProperty.call(node.schema, 'const')) values.push([`${node.path}.const`, node.schema.const]);
  if (Array.isArray(node.schema.enum)) node.schema.enum.forEach((value, index) => values.push([`${node.path}.enum[${index}]`, value]));
  if (Array.isArray(node.schema.examples)) node.schema.examples.forEach((value, index) => values.push([`${node.path}.examples[${index}]`, value]));
  if (Object.prototype.hasOwnProperty.call(node.schema, 'default')) values.push([`${node.path}.default`, node.schema.default]);
  return values;
}

export const schemaReferencesRule: SchemaRule = {
  id: 'schema-references',
  description: 'Require schema-valued fields to use absolute URI references.',
  check: ({ schema }) => {
    if (!isSchemaObject(schema)) return [];
    const findings = [];
    for (const node of namedFields(schema)) {
      if (!node.key || !SCHEMA_REFERENCE_FIELD.test(node.key)) continue;
      for (const [path, value] of valuesAt(node)) {
        if (typeof value !== 'string') {
          findings.push(finding(schemaReferencesRule, 'SCHEMA_REFERENCE_NOT_STRING', path, 'Schema-valued fields must use string URI references.'));
        } else if (!ABSOLUTE_URI.test(value)) {
          findings.push(finding(schemaReferencesRule, 'SCHEMA_REFERENCE_NOT_ABSOLUTE_URI', path, 'Schema-valued fields must use an absolute URI, not a compact or relative identifier.'));
        }
      }
    }
    return findings;
  },
};