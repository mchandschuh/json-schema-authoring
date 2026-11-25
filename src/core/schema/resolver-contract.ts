export interface SchemaResolverAjv {
  addSchema(schema: Record<string, unknown>, key?: string): unknown;
  getSchema?(key: string): unknown;
}

export interface SchemaResolverContext {
  readonly documentPath: string;
  readonly rootSchema?: unknown;
  readonly schemaRoots?: readonly string[];
}

export interface SchemaResolver {
  registerSync(ajv: SchemaResolverAjv, context: SchemaResolverContext): void;
  register(ajv: SchemaResolverAjv, context: SchemaResolverContext): Promise<void>;
  createLoadSchema(context: SchemaResolverContext): (uri: string) => Promise<Record<string, unknown>>;
}