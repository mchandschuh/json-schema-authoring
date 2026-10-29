export type SchemaObject = Record<string, unknown>;

export interface SchemaFinding {
  readonly code: string;
  readonly rule: string;
  readonly path: string;
  readonly message: string;
  readonly severity: 'error' | 'warning';
}

export interface SchemaRuleContext {
  readonly schema: unknown;
  readonly documentPath: string;
  readonly validateInstance?: (instance: unknown, schema: unknown) => readonly string[];
}

export interface SchemaRule {
  readonly id: string;
  readonly description: string;
  check(context: SchemaRuleContext): readonly SchemaFinding[];
}

export interface ValidationReport {
  readonly path: string;
  readonly valid: boolean;
  readonly findings: readonly SchemaFinding[];
}

export function isSchemaObject(value: unknown): value is SchemaObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function pathFor(base: string, key: string | number): string {
  if (typeof key === 'number') return `${base}[${key}]`;
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? `${base}.${key}` : `${base}[${JSON.stringify(key)}]`;
}

export function finding(rule: SchemaRule, code: string, path: string, message: string): SchemaFinding {
  return { code, rule: rule.id, path, message, severity: 'error' };
}