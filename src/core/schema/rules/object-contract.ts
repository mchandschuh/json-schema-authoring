import { schemaNodes } from '../traverse.js';
import { finding, isSchemaObject, type SchemaRule } from '../types.js';

export const objectContractRule: SchemaRule = {
  id: 'object-contract',
  description: 'Require explicit required lists and closed object properties.',
  check: ({ schema }) => {
    if (!isSchemaObject(schema)) return [];
    const findings = [];
    for (const node of schemaNodes(schema)) {
      const properties = node.schema.properties;
      const patternProperties = node.schema.patternProperties;
      if (!isSchemaObject(properties) && !isSchemaObject(patternProperties)) continue;
      if (!Array.isArray(node.schema.required)) findings.push(finding(objectContractRule, 'MISSING_REQUIRED', `${node.path}.required`, 'Object schemas with fields must declare a required array; include required fields and leave optional fields out.'));
      else {
        const required = node.schema.required;
        const duplicates = required.filter((name, index) => required.indexOf(name) !== index);
        if (duplicates.length > 0) findings.push(finding(objectContractRule, 'DUPLICATE_REQUIRED', `${node.path}.required`, 'The required array must contain unique field names.'));
        for (const name of required) {
          if (typeof name !== 'string' || (!properties || !Object.prototype.hasOwnProperty.call(properties, name)) && (!patternProperties || !Object.prototype.hasOwnProperty.call(patternProperties, name))) {
            findings.push(finding(objectContractRule, 'UNKNOWN_REQUIRED', `${node.path}.required`, `Required field "${String(name)}" is not declared in properties or patternProperties.`));
          }
        }
      }
      if (node.schema.additionalProperties !== false && node.schema.unevaluatedProperties !== false) {
        findings.push(finding(objectContractRule, 'OPEN_OBJECT', node.path, 'Close object schemas with additionalProperties: false or unevaluatedProperties: false unless an explicit patternProperties policy is intended.'));
      }
    }
    return findings;
  },
};