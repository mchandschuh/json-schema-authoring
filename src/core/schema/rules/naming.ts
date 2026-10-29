import { isSchemaObject, finding, type SchemaRule } from '../types.js';
import { schemaNodes } from '../traverse.js';

const LOWER_CAMEL = /^[a-z][A-Za-z0-9]*$/;
const PASCAL_CASE = /^[A-Z][A-Za-z0-9]*$/;

export const namingRule: SchemaRule = {
  id: 'naming',
  description: 'Enforce lowerCamelCase fields and PascalCase reusable definition names.',
  check: ({ schema }) => {
    if (!isSchemaObject(schema)) return [];
    const findings = [];
    for (const node of schemaNodes(schema)) {
      const properties = node.schema.properties;
      if (isSchemaObject(properties)) {
        for (const name of Object.keys(properties)) {
          if (!LOWER_CAMEL.test(name)) findings.push(finding(namingRule, 'INVALID_FIELD_NAME', `${node.path}.properties.${name}`, `Field name "${name}" must use lowerCamelCase.`));
        }
      }
      const definitions = node.schema.$defs;
      if (isSchemaObject(definitions)) {
        for (const name of Object.keys(definitions)) {
          if (!PASCAL_CASE.test(name)) findings.push(finding(namingRule, 'INVALID_DEFINITION_NAME', `${node.path}.$defs.${name}`, `Definition name "${name}" must use PascalCase.`));
        }
      }
    }
    return findings;
  },
};