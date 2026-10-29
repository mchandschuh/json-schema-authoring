import type { SchemaRule } from '../types.js';
import { examplesRule } from './examples.js';
import { fieldDocumentationRule } from './field-documentation.js';
import { namingRule } from './naming.js';
import { objectContractRule } from './object-contract.js';
import { rootMetadataRule } from './root-metadata.js';
import { schemaReferencesRule } from './schema-references.js';

export const schemaRules: readonly SchemaRule[] = [
  rootMetadataRule,
  fieldDocumentationRule,
  namingRule,
  objectContractRule,
  schemaReferencesRule,
  examplesRule,
];