import { describe, expect, it } from 'vitest';
import { DocumentParseError, parseDocument } from '../src/core/document/parser.js';

describe('instance document parser', () => {
  it('parses equivalent JSON and YAML object documents into the same value', () => {
    const json = parseDocument('{"name":"Ada","roles":["reviewer"],"active":true}', 'instance.json');
    const yaml = parseDocument('name: Ada\nroles:\n  - reviewer\nactive: true\n', 'instance.yaml');

    expect(json).toEqual({ format: 'json', value: { name: 'Ada', roles: ['reviewer'], active: true } });
    expect(yaml.format).toBe('yaml');
    expect(yaml.value).toEqual(json.value);
  });

  it('supports YAML comments, block strings, anchors, and aliases', () => {
    const result = parseDocument([
      '# YAML-only presentation features',
      'description: |',
      '  First line.',
      '  Second line.',
      'defaults: &defaults',
      '  enabled: true',
      'copy: *defaults',
    ].join('\n'), 'instance.yml');

    expect(result.format).toBe('yaml');
    expect(result.value).toEqual({
      description: 'First line.\nSecond line.\n',
      defaults: { enabled: true },
      copy: { enabled: true },
    });
  });

  it('parses JSON scalar and array instances without coercion', () => {
    expect(parseDocument('42', 'value.json').value).toBe(42);
    expect(parseDocument('["one",2,false,null]', 'value.json').value).toEqual(['one', 2, false, null]);
  });

  it('parses YAML scalar and array instances using YAML 1.2 types', () => {
    expect(parseDocument('42', 'value.yaml').value).toBe(42);
    expect(parseDocument('- one\n- 2\n- false\n- null\n', 'value.yml').value).toEqual(['one', 2, false, null]);
  });

  it('rejects YAML duplicate keys instead of silently choosing one value', () => {
    expect(() => parseDocument('name: Ada\nname: Grace\n', 'duplicate.yaml')).toThrow(/unique|Invalid YAML/i);
  });

  it('rejects YAML streams containing more than one document', () => {
    expect(() => parseDocument('---\nname: Ada\n---\nname: Grace\n', 'stream.yaml')).toThrow(/exactly one YAML document/i);
  });

  it('rejects empty YAML documents', () => {
    expect(() => parseDocument('', 'empty.yml')).toThrow(/document is empty/i);
  });

  it('rejects unresolved YAML tags rather than converting them implicitly', () => {
    expect(() => parseDocument('value: !custom hello\n', 'tagged.yaml')).toThrow(/Unresolved tag|Invalid YAML/i);
  });

  it('rejects malformed YAML with a parser diagnostic', () => {
    expect(() => parseDocument('items: [one, two', 'malformed.yaml')).toThrow(/Invalid YAML/i);
  });

  it('rejects malformed JSON without falling back to YAML parsing', () => {
    expect(() => parseDocument('{"name":"Ada",}', 'malformed.json')).toThrow(/Invalid JSON/i);
    expect(() => parseDocument('name: Ada\n', 'yaml-looking.json')).toThrow(/Invalid JSON/i);
  });

  it('rejects unsupported extensions before parsing content', () => {
    expect(() => parseDocument('{}', 'instance.txt')).toThrow(DocumentParseError);
    expect(() => parseDocument('{}', 'instance.txt')).toThrow(/Unsupported document format/i);
  });
});