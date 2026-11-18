import type { CommandDescriptor } from '../../core/cli/descriptor.js';
import {
  listRegisteredSchemas,
  SchemaRegistryConfiguration,
  type RegistryConfigSelection,
  type RegisteredDirectory,
  type RegisteredSchema,
} from '../../core/schema/registry.js';
import { configLocation, locationDefault, optionValue } from '../registry-options.js';

const HELP_LINES = [
  'Usage: schema-validate list [options]',
  'List all schemas registered in the configured schema directories.',
  '',
  'Options:',
  '  -h, --help  Show this help text',
  '  --json  Emit machine-readable JSON',
  '  --config-location <app|home|env>  Select configuration location (default: all)',
];

interface ParsedArguments {
  readonly help: boolean;
  readonly json: boolean;
  readonly configLocation: RegistryConfigSelection;
}

function parse(args: readonly string[]): ParsedArguments {
  let help = false;
  let json = false;
  let selected: RegistryConfigSelection = locationDefault(false);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === '--help' || arg === '-h') help = true;
    else if (arg === '--json') json = true;
    else if (arg === '--config-location') {
      selected = configLocation(optionValue(args, index, '--config-location'));
      index += 1;
    } else if (arg.startsWith('--config-location=')) {
      selected = configLocation(arg.slice('--config-location='.length));
    } else throw new Error(`Unknown option: ${arg}`);
  }
  return { help, json, configLocation: selected };
}

function outputSchema(schema: RegisteredSchema, entries: readonly RegisteredDirectory[]): Record<string, unknown> {
  return {
    id: schema.id,
    path: schema.path,
    directory: schema.directory,
    definedIn: entries
      .filter((entry) => entry.directory === schema.directory)
      .map(({ location, configPath }) => ({ location, configPath })),
  };
}

export function help(): number {
  console.log(HELP_LINES.join('\n'));
  return 0;
}

const command: CommandDescriptor = {
  name: 'list',
  description: 'List all registered schemas',
  handler: async (args) => {
    let parsed: ParsedArguments;
    try {
      parsed = parse(args);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      console.error('Run "schema-validate list --help" for usage.');
      return 2;
    }
    if (parsed.help) return help();
    try {
      const configuration = new SchemaRegistryConfiguration();
      const entries = await configuration.list(parsed.configLocation);
      const schemas = await listRegisteredSchemas(entries);
      const output = schemas.map((schema) => outputSchema(schema, entries));
      if (parsed.json) console.log(JSON.stringify({ schemas: output }, null, 2));
      else if (output.length === 0) console.log('No registered schemas.');
      else output.forEach((schema) => console.log(`${schema.id} ${schema.path}`));
      return 0;
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      return 1;
    }
  },
};

export default command;