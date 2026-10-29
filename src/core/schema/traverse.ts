import { isSchemaObject, pathFor, type SchemaObject } from './types.js';

export interface SchemaNode {
  readonly schema: SchemaObject;
  readonly path: string;
  readonly parent?: SchemaObject;
  readonly key?: string;
}

const childSchemaKeys = ['additionalProperties', 'additionalItems', 'contains', 'if', 'then', 'else', 'not', 'propertyNames', 'contentSchema', 'unevaluatedProperties', 'unevaluatedItems'];
const childSchemaArrayKeys = ['allOf', 'anyOf', 'oneOf', 'prefixItems'];

export function schemaNodes(root: unknown): readonly SchemaNode[] {
  if (!isSchemaObject(root)) return [];
  const result: SchemaNode[] = [];
  const seen = new Set<SchemaObject>();
  const visit = (schema: SchemaObject, path: string, parent?: SchemaObject, key?: string): void => {
    if (seen.has(schema)) return;
    seen.add(schema);
    result.push({ schema, path, parent, key });
    for (const childKey of childSchemaKeys) {
      const child = schema[childKey];
      if (isSchemaObject(child)) visit(child, pathFor(path, childKey), schema, childKey);
    }
    for (const childKey of childSchemaArrayKeys) {
      const children = schema[childKey];
      if (Array.isArray(children)) children.forEach((child, index) => {
        if (isSchemaObject(child)) visit(child, `${pathFor(path, childKey)}[${index}]`, schema, childKey);
      });
    }
    for (const [propertyName, child] of Object.entries(schema.properties ?? {})) {
      if (isSchemaObject(child)) visit(child, `${pathFor(path, 'properties')}.${propertyName}`, schema, propertyName);
    }
    for (const [propertyName, child] of Object.entries(schema.patternProperties ?? {})) {
      if (isSchemaObject(child)) visit(child, `${pathFor(path, 'patternProperties')}.${propertyName}`, schema, propertyName);
    }
    for (const [definitionName, child] of Object.entries(schema.$defs ?? {})) {
      if (isSchemaObject(child)) visit(child, `${pathFor(path, '$defs')}.${definitionName}`, schema, definitionName);
    }
    for (const [dependencyName, child] of Object.entries(schema.dependentSchemas ?? {})) {
      if (isSchemaObject(child)) visit(child, `${pathFor(path, 'dependentSchemas')}.${dependencyName}`, schema, dependencyName);
    }
    const items = schema.items;
    if (isSchemaObject(items)) visit(items, pathFor(path, 'items'), schema, 'items');
  };
  visit(root, '$');
  return result;
}

export function namedFields(root: unknown): readonly SchemaNode[] {
  return schemaNodes(root).filter((node) => node.parent && node.key !== undefined
    && ((node.parent.properties && Object.prototype.hasOwnProperty.call(node.parent.properties, node.key))
      || (node.parent.patternProperties && Object.prototype.hasOwnProperty.call(node.parent.patternProperties, node.key))));
}

export function definitionNodes(root: unknown): readonly SchemaNode[] {
  return schemaNodes(root).filter((node) => node.parent && node.key !== undefined
    && node.path.includes('.$defs.')
    && isSchemaObject(node.parent.$defs)
    && Object.prototype.hasOwnProperty.call(node.parent.$defs, node.key));
}