import type { RegistryConfigSelection } from '../core/schema/registry.js';

export function optionValue(args: readonly string[], index: number, option: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith('-')) throw new Error(`${option} requires a value.`);
  return value;
}

export function configLocation(value: string, allowAll = false): RegistryConfigSelection {
  if (value === 'app' || value === 'home' || value === 'env') return value;
  if (allowAll && value === 'all') return value;
  throw new Error(`--config-location must be one of ${allowAll ? 'app, home, env, or all' : 'app, home, or env'}.`);
}

export function locationDefault(mutation: boolean): RegistryConfigSelection {
  return mutation ? 'home' : 'all';
}