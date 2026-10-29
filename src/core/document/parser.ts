import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import YAML from 'yaml';

export type DocumentFormat = 'json' | 'yaml';

export type DocumentParseErrorCode =
  | 'FILE_READ_ERROR'
  | 'INVALID_JSON'
  | 'INVALID_YAML'
  | 'UNSUPPORTED_FORMAT';

export class DocumentParseError extends Error {
  readonly code: DocumentParseErrorCode;

  constructor(code: DocumentParseErrorCode, message: string) {
    super(message);
    this.name = 'DocumentParseError';
    this.code = code;
  }
}

export interface ParsedDocument {
  readonly format: DocumentFormat;
  readonly value: unknown;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatForPath(documentPath: string): DocumentFormat {
  const extension = extname(documentPath).toLowerCase();
  if (extension === '.json') return 'json';
  if (extension === '.yaml' || extension === '.yml') return 'yaml';
  throw new DocumentParseError(
    'UNSUPPORTED_FORMAT',
    `Unsupported document format "${extension || '(none)'}"; use a .json, .yaml, or .yml document.`,
  );
}

function parseJson(source: string): unknown {
  try {
    return JSON.parse(source) as unknown;
  } catch (error) {
    throw new DocumentParseError('INVALID_JSON', `Invalid JSON: ${errorMessage(error)}`);
  }
}

function parseYaml(source: string): unknown {
  let documents: ReturnType<typeof YAML.parseAllDocuments>;
  try {
    documents = YAML.parseAllDocuments(source, {
      version: '1.2',
      uniqueKeys: true,
    });
  } catch (error) {
    throw new DocumentParseError('INVALID_YAML', `Invalid YAML: ${errorMessage(error)}`);
  }

  if (documents.length !== 1) {
    throw new DocumentParseError(
      'INVALID_YAML',
      documents.length === 0
        ? 'Invalid YAML: the document is empty.'
        : 'Invalid YAML: exactly one YAML document is required.',
    );
  }

  const [document] = documents;
  const diagnostics = [...document.errors, ...document.warnings];
  if (diagnostics.length > 0) {
    throw new DocumentParseError(
      'INVALID_YAML',
      `Invalid YAML: ${diagnostics.map((diagnostic) => diagnostic.message).join('; ')}`,
    );
  }

  try {
    return document.toJS();
  } catch (error) {
    throw new DocumentParseError('INVALID_YAML', `Invalid YAML: ${errorMessage(error)}`);
  }
}

export function parseDocument(source: string, documentPath: string): ParsedDocument {
  const format = formatForPath(documentPath);
  return { format, value: format === 'json' ? parseJson(source) : parseYaml(source) };
}

export async function parseDocumentFile(documentPath: string): Promise<ParsedDocument> {
  let source: string;
  try {
    source = await readFile(documentPath, 'utf8');
  } catch (error) {
    throw new DocumentParseError('FILE_READ_ERROR', `Cannot read document: ${errorMessage(error)}`);
  }
  return parseDocument(source, documentPath);
}