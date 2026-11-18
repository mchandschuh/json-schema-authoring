import type { CommandDescriptor } from '../../core/cli/descriptor.js';
import {
  SchemaRegistryConfiguration,
  type RegistryConfigLocation,
  type RegisteredDirectory,
} from '../../core/schema/registry.js';
import { configLocation, locationDefault, optionValue } from '../registry-options.js';

const HELP_LINES = [
  'Usage: schema-validate registry <add|list|remove> [directory] [options]',
  'Manage configured schema directories.',
  '',
  'Commands:',
  '  add <directory>  Add a schema directory (default location: home)',
  '  list  List configured directories and their configuration locations',
  '  remove <directory>  Remove a schema directory (default location: home)',
  '',
  'Options:',
  '  -h, --help  Show this help text',
  '  --json  Emit machine-readable JSON',
  '  --config-location <app|home|env>  Select configuration location (default: all for list, home for add/remove)',
];

interface ParsedArguments {
  readonly action?: 'add' | 'list' | 'remove';
  readonly directory?: string;
  readonly help: boolean;
  readonly json: boolean;
  readonly configLocation: RegistryConfigLocation | 'all';
}

function parse(args: readonly string[]): ParsedArguments {
  let action: ParsedArguments['action'];
  let directory: string | undefined;
  let help = false;
  let json = false;
  let selected: ParsedArguments['configLocation'] = locationDefault(false);
  let selectedExplicitly = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === '--help' || arg === '-h') help = true;
    else if (arg === '--json') json = true;
    else if (arg === '--config-location') {
      selected = configLocation(optionValue(args, index, '--config-location'), false);
      selectedExplicitly = true;
      index += 1;
    } else if (arg.startsWith('--config-location=')) {
      selected = configLocation(arg.slice('--config-location='.length), false);
      selectedExplicitly = true;
    } else if (arg.startsWith('-')) throw new Error(`Unknown option: ${arg}`);
    else if (!action) {
      if (arg !== 'add' && arg !== 'list' && arg !== 'remove') throw new Error(`Unknown registry command: ${arg}`);
      action = arg;
      if (!selectedExplicitly) selected = locationDefault(arg !== 'list');
    } else if (!directory) directory = arg;
    else throw new Error(`Unexpected argument: ${arg}`);
  }
  return { action, directory, help, json, configLocation: selected };
}

function directoryOutput(entry: RegisteredDirectory): Record<string, string> {
  return { directory: entry.directory, location: entry.location, configPath: entry.configPath };
}

export function help(): number {
  console.log(HELP_LINES.join('\n'));
  return 0;
}

const command: CommandDescriptor = {
  name: 'registry',
  description: 'Manage registered schema directories',
  handler: async (args) => {
    let parsed: ParsedArguments;
    try {
      parsed = parse(args);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      console.error('Run "schema-validate registry --help" for usage.');
      return 2;
    }
    if (parsed.help || !parsed.action) return help();
    if ((parsed.action === 'add' || parsed.action === 'remove') && !parsed.directory) {
      console.error(`registry ${parsed.action} requires a directory.`);
      return 2;
    }
    try {
      const configuration = new SchemaRegistryConfiguration();
      if (parsed.action === 'list') {
        const entries = await configuration.list(parsed.configLocation);
        const output = entries.map(directoryOutput);
        if (parsed.json) console.log(JSON.stringify({ directories: output }, null, 2));
        else if (output.length === 0) console.log('No schema registry directories.');
        else output.forEach((entry) => console.log(`${entry.location} ${entry.directory} (${entry.configPath})`));
        return 0;
      }
      const location = parsed.configLocation === 'all' ? 'home' : parsed.configLocation;
      if (parsed.action === 'add') {
        const result = await configuration.add(parsed.directory!, location);
        const output = { ...directoryOutput(result.entry), added: result.added };
        if (parsed.json) console.log(JSON.stringify(output, null, 2));
        else console.log(`${result.added ? 'Added' : 'Already configured'} ${result.entry.directory} (${location}, ${result.entry.configPath})`);
        return 0;
      }
      const result = await configuration.remove(parsed.directory!, location);
      const output = { ...directoryOutput(result.entry), removed: result.removed };
      if (parsed.json) console.log(JSON.stringify(output, null, 2));
      else console.log(`Removed ${result.entry.directory} (${location}, ${result.entry.configPath})`);
      return 0;
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      return 1;
    }
  },
};

export default command;