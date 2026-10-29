import { definitionNodes, namedFields, schemaNodes } from '../traverse.js';
import { finding, isNonEmptyString, isSchemaObject, type SchemaRule } from '../types.js';

function jsonType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function basicTypeMatches(instance: unknown, schema: Record<string, unknown>): boolean {
  if (typeof schema.type !== 'string') return true;
  if (schema.type === 'integer') return typeof instance === 'number' && Number.isInteger(instance);
  if (schema.type === 'number') return typeof instance === 'number' && Number.isFinite(instance);
  return jsonType(instance) === schema.type;
}

export const examplesRule: SchemaRule = {
  id: 'examples',
  description: 'Require examples to be arrays and validate simple local examples against their field type.',
  check: ({ schema, validateInstance }) => {
    if (!isSchemaObject(schema)) return [];
    const findings = [];
    const nodes = [{ schema, path: '$' }, ...namedFields(schema), ...definitionNodes(schema)];
    for (const node of nodes) {
      if (!Array.isArray(node.schema.examples) || node.schema.examples.length === 0) continue;
      for (let index = 0; index < node.schema.examples.length; index += 1) {
        const example = node.schema.examples[index];
        if (!basicTypeMatches(example, node.schema)) findings.push(finding(examplesRule, 'EXAMPLE_TYPE_MISMATCH', `${node.path}.examples[${index}]`, `Example type ${jsonType(example)} does not match declared type ${String(node.schema.type)}.`));
        if (validateInstance && !isNonEmptyString(node.schema.$ref)) {
          const errors = validateInstance(example, node.schema);
          if (errors.length > 0) findings.push(finding(examplesRule, 'EXAMPLE_INVALID', `${node.path}.examples[${index}]`, `Example does not validate: ${errors[0]}`));
        }
      }
    }
    return findings;
  },
};