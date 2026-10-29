import { readFile } from 'node:fs/promises';
import type { CommandDescriptor } from '../../core/cli/descriptor.js';
import { parseDocumentFile, type DocumentParseError, type DocumentFormat } from '../../core/document/parser.js';
import { validateInstanceAsync, type InstanceValidationError, type InstanceValidationReport } from '../../core/schema/instance.js';
import { SchemaValidator, type ValidationReport } from '../../core/schema/validator.js';

const HELP_LINES = [
  'Usage: schema-validate <schema.json> [more-schema.json ...] [options]',
  'Usage: schema-validate --root <directory> --schema <schema.json> --document <document.json|document.yaml>',
  'Validate one or more JSON Schema 2020-12 documents and enforce authoring conventions.',
  'The --schema/--document form validates a JSON or YAML instance against one schema.',
  '',
  'Options:',
  '  -h, --help  Show this help text',
  '  -v, --version  Show the installed version',
  '  --json  Emit one machine-readable JSON report for all files',
  '  --root <directory>  Restrict local reference resolution to this schema root',
  '  --schema <schema.json>  Schema to use in instance-validation mode',
  '  --document <document.json|document.yaml>  JSON or YAML instance to validate',
  '',
  'Rules include root metadata, field descriptions/examples, naming, closed object contracts,',
  'absolute URI schema references, required-field references,',
  'and examples that match their declared types and schemas.',
];

function printReport(report: ValidationReport): void {
  if (report.valid) {
    console.log(`PASS ${report.path}`);
    return;
  }
  console.error(`FAIL ${report.path}`);
  for (const item of report.findings) console.error(`  ${item.path} [${item.code}] ${item.message}`);
}

interface ParsedArguments {
  readonly paths: string[];
  readonly json: boolean;
  readonly help: boolean;
  readonly version: boolean;
  readonly schemaRoot?: string;
  readonly schemaPath?: string;
  readonly documentPath?: string;
}

interface InstanceReport {
  readonly valid: boolean;
  readonly schema: string;
  readonly document: string;
  readonly format?: DocumentFormat;
  readonly errors: readonly InstanceValidationError[];
}

function optionValue(args: readonly string[], index: number, option: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith('-')) throw new Error(`${option} requires a value.`);
  return value;
}

function parse(args: readonly string[]): ParsedArguments {
  const paths: string[] = [];
  let json = false;
  let help = false;
  let version = false;
  let schemaRoot: string | undefined;
  let schemaPath: string | undefined;
  let documentPath: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === '--json') json = true;
    else if (arg === '--help' || arg === '-h') help = true;
    else if (arg === '--version' || arg === '-v') version = true;
    else if (arg === '--root') {
      schemaRoot = optionValue(args, index, '--root');
      index += 1;
    }
    else if (arg.startsWith('--root=')) {
      schemaRoot = arg.slice('--root='.length);
      if (!schemaRoot) throw new Error('--root requires a directory.');
    }
    else if (arg === '--schema') {
      schemaPath = optionValue(args, index, '--schema');
      index += 1;
    }
    else if (arg.startsWith('--schema=')) {
      schemaPath = arg.slice('--schema='.length);
      if (!schemaPath) throw new Error('--schema requires a schema file.');
    }
    else if (arg === '--document') {
      documentPath = optionValue(args, index, '--document');
      index += 1;
    }
    else if (arg.startsWith('--document=')) {
      documentPath = arg.slice('--document='.length);
      if (!documentPath) throw new Error('--document requires a document file.');
    }
    else if (arg.startsWith('-')) throw new Error(`Unknown option: ${arg}`);
    else paths.push(arg);
  }
  return { paths, json, help, version, schemaRoot, schemaPath, documentPath };
}

function instanceError(keyword: string, message: string): InstanceValidationError {
  return { instancePath: '$', keyword, message, params: {} };
}

async function readJsonSchema(schemaPath: string): Promise<unknown> {
  let source: string;
  try {
    source = await readFile(schemaPath, 'utf8');
  } catch (error) {
    throw new Error(`Cannot read schema: ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    return JSON.parse(source) as unknown;
  } catch (error) {
    throw new Error(`Invalid JSON schema: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function validateInstanceFile(schemaPath: string, documentPath: string, schemaRoot: string): Promise<InstanceReport> {
  try {
    const [schema, document] = await Promise.all([readJsonSchema(schemaPath), parseDocumentFile(documentPath)]);
    const result: InstanceValidationReport = await validateInstanceAsync(schema, document.value, {
      documentPath: schemaPath,
      schemaRoot,
    });
    return { schema: schemaPath, document: documentPath, format: document.format, ...result };
  } catch (error) {
    const keyword = error instanceof Error && 'code' in error && (error as DocumentParseError).code === 'FILE_READ_ERROR'
      ? 'file'
      : error instanceof Error && 'code' in error
        ? 'document'
        : 'schema';
    return {
      valid: false,
      schema: schemaPath,
      document: documentPath,
      errors: [instanceError(keyword, error instanceof Error ? error.message : String(error))],
    };
  }
}

function printInstanceReport(report: InstanceReport): void {
  if (report.valid) {
    console.log(`PASS ${report.document}`);
    return;
  }
  console.error(`FAIL ${report.document}`);
  for (const item of report.errors) console.error(`  ${item.instancePath} [${item.keyword}] ${item.message}`);
}

export function help(): number {
  console.log(HELP_LINES.join('\n'));
  return 0;
}

const command: CommandDescriptor = {
  name: 'validate',
  description: 'Validate JSON Schema documents and authoring conventions',
  handler: async (args) => {
    let parsed: ReturnType<typeof parse>;
    try {
      parsed = parse(args);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      console.error('Run "schema-validate --help" for usage.');
      return 2;
    }
    if (parsed.help) return help();
    const instanceMode = parsed.schemaPath !== undefined || parsed.documentPath !== undefined;
    if (instanceMode) {
      if (!parsed.schemaPath || !parsed.documentPath) {
        console.error('--schema and --document must be supplied together.');
        console.error('Run "schema-validate --help" for usage.');
        return 2;
      }
      if (!parsed.schemaRoot) {
        console.error('--root is required in instance-validation mode.');
        console.error('Run "schema-validate --help" for usage.');
        return 2;
      }
      if (parsed.paths.length > 0) {
        console.error('Positional schema paths cannot be combined with --schema/--document.');
        console.error('Run "schema-validate --help" for usage.');
        return 2;
      }
      const report = await validateInstanceFile(parsed.schemaPath, parsed.documentPath, parsed.schemaRoot);
      if (parsed.json) console.log(JSON.stringify(report, null, 2));
      else printInstanceReport(report);
      return report.valid ? 0 : 1;
    }
    if (parsed.paths.length === 0) return help();
    const reports = await Promise.all(parsed.paths.map((path) => new SchemaValidator({ schemaRoot: parsed.schemaRoot }).validateFile(path)));
    if (parsed.json) console.log(JSON.stringify({ valid: reports.every((report) => report.valid), reports }, null, 2));
    else reports.forEach(printReport);
    return reports.every((report) => report.valid) ? 0 : 1;
  },
};

export default command;