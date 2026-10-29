import { definitionNodes, namedFields, type SchemaNode } from '../traverse.js';
import { finding, isNonEmptyString, isSchemaObject, type SchemaRule } from '../types.js';

function checkNode(rule: SchemaRule, node: SchemaNode) {
  const findings = [];
  if (!isNonEmptyString(node.schema.description)) findings.push(finding(rule, 'FIELD_MISSING_DESCRIPTION', `${node.path}.description`, 'Every named field and reusable definition needs a non-empty description.'));
  if (!Array.isArray(node.schema.examples) || node.schema.examples.length === 0) findings.push(finding(rule, 'FIELD_MISSING_EXAMPLE', `${node.path}.examples`, 'Every named field and reusable definition needs at least one example.'));
  return findings;
}

export const fieldDocumentationRule: SchemaRule = {
  id: 'field-documentation',
  description: 'Require descriptions and examples on named fields and reusable definitions.',
  check: ({ schema }) => {
    if (!isSchemaObject(schema)) return [];
    const nodes = [...namedFields(schema), ...definitionNodes(schema)];
    return nodes.flatMap((node) => checkNode(fieldDocumentationRule, node));
  },
};