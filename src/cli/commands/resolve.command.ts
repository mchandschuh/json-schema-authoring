import type { CommandDescriptor } from '../../core/cli/descriptor.js';
import { resolveRegisteredSchema, SchemaResolutionError } from '../../core/schema/resolve.js';

const HELP_LINES = [
  'Usage: schema-validate resolve <schema-type> [options]',
  'Resolve the complete JSON Schema document from the local registered schema catalog.',
  '',
  'Examples:',
  '  schema-validate resolve https://schemas.handschuh.dev/sdlc/task-envelope/v1',
  '  schema-validate resolve sdlc/task-envelope/v1',
  '  schema-validate resolve task-envelope/v1',
  '  schema-validate resolve task-envelope  # match the registered schema ID',
  '',
  'Options:',
  '  -h, --help  Show this help text',
  '  --json  Emit the schema as formatted JSON (the default and only output format)',
];

interface ParsedArguments {
  readonly schemaType?: string;
  readonly help: boolean;
}

function parse(args: readonly string[]): ParsedArguments {
  let schemaType: string | undefined;
  let help = false;
  for (const arg of args) {
    if (arg === '--help' || arg === '-h') help = true;
    else if (arg === '--json') continue;
    else if (arg.startsWith('-')) throw new Error(`Unknown option: ${arg}`);
    else if (schemaType) throw new Error(`Unexpected argument: ${arg}`);
    else schemaType = arg;
  }
  return { schemaType, help };
}

export function help(): number {
  console.log(HELP_LINES.join('\n'));
  return 0;
}

const command: CommandDescriptor = {
  name: 'resolve',
  description: 'Resolve a complete schema document from the local registry',
  handler: async (args) => {
    let parsed: ParsedArguments;
    try {
      parsed = parse(args);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      console.error('Run "schema-validate resolve --help" for usage.');
      return 2;
    }
    if (parsed.help) return help();
    if (!parsed.schemaType) {
      console.error('resolve requires a schema type.');
      console.error('Run "schema-validate resolve --help" for usage.');
      return 2;
    }
    try {
      const resolved = await resolveRegisteredSchema(parsed.schemaType);
      console.log(JSON.stringify(resolved.schema, null, 2));
      return 0;
    } catch (error) {
      console.error(error instanceof SchemaResolutionError ? error.message : String(error));
      return 1;
    }
  },
};

export default command;