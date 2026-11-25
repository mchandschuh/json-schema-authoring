export interface SchemaResolverAjv {
  addSchema(schema: Record<string, unknown>, key?: string): unknown;
  getSchema?(key: string): unknown;
}

export interface SchemaResolverContext {
  readonly documentPath: string;
  readonly rootSchema?: unknown;
  readonly schemaRoots?: readonly string[];
}

export interface SchemaResolution {
  readonly requestedUri: string;
  readonly canonicalUri: string;
  readonly path: string;
  readonly schema: Record<string, unknown>;
}

export interface SchemaReferenceResolver {
  resolveSync(uri: string, context: SchemaResolverContext): SchemaResolution;
  resolve(uri: string, context: SchemaResolverContext): Promise<SchemaResolution>;
  resolveManySync(uris: readonly string[], context: SchemaResolverContext): readonly SchemaResolution[];
  resolveMany(uris: readonly string[], context: SchemaResolverContext): Promise<readonly SchemaResolution[]>;
}

export interface SchemaResolver extends SchemaReferenceResolver {
  registerSync(ajv: SchemaResolverAjv, context: SchemaResolverContext): void;
  register(ajv: SchemaResolverAjv, context: SchemaResolverContext): Promise<void>;
  createLoadSchema(context: SchemaResolverContext): (uri: string) => Promise<Record<string, unknown>>;
}