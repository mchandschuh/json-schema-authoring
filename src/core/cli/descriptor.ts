export type CommandHandler = (args: readonly string[]) => number | Promise<number>;

export interface CommandDescriptor {
  readonly name: string;
  readonly description: string;
  readonly handler: CommandHandler;
}

export interface CommandModule {
  readonly command?: unknown;
  readonly default?: unknown;
}

export function isCommandDescriptor(value: unknown): value is CommandDescriptor {
  if (!value || typeof value !== 'object') return false;
  const descriptor = value as Record<string, unknown>;
  return typeof descriptor.name === 'string'
    && /^[a-z][a-z0-9-]*$/.test(descriptor.name)
    && typeof descriptor.description === 'string'
    && descriptor.description.length > 0
    && typeof descriptor.handler === 'function';
}