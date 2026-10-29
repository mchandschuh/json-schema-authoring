import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validateInstanceAsync } from '../src/core/schema/instance.js';

const schemaPath = fileURLToPath(new URL('./fixtures/decomposition.schema.json', import.meta.url));
const schemaRoot = fileURLToPath(new URL('./fixtures', import.meta.url));

async function validatePayload(result: unknown) {
  const schema = JSON.parse(await readFile(schemaPath, 'utf8')) as Record<string, unknown>;
  return validateInstanceAsync(schema, {
    intent: {
      range: {
        name: 'task-contract-decomposition',
        description: 'Decompose task-contract work into bounded child tasks.',
        start: '00000000',
        end: '99999999',
        maxDepth: 1,
        maxChildren: 2,
        allowableChildTypes: ['implementation', 'validation'],
      },
      rules: {
        singleLevel: {
          instruction: 'Produce one bounded level of children.',
          verification: 'Confirm that no grandchildren were created.',
        },
      },
    },
    result,
  }, { documentPath: schemaPath, schemaRoot });
}

describe('decomposition produced-task results', () => {
  it('accepts qualified task references paired with shared task types', async () => {
    await expect(validatePayload({
      status: 'decomposed',
      tasks: [
        { ref: 'WI-0003|50000000#task/T-001', taskType: 'implementation' },
        { ref: 'WI-0003|60000000#task/T-002', taskType: 'validation' },
      ],
      limitations: [],
    })).resolves.toMatchObject({ valid: true, errors: [] });
  });

  it('rejects malformed references, invalid types, and the removed childTaskUids shape', async () => {
    const invalid = await validatePayload({
      status: 'decomposed',
      childTaskUids: ['WI-0003-50000000'],
      tasks: [
        { ref: 'WI-0003|50000000', taskType: 'not-a-task-type' },
      ],
      limitations: [],
    });

    expect(invalid.valid).toBe(false);
    expect(invalid.errors.map((error) => error.instancePath)).toEqual(expect.arrayContaining([
      '/result',
      '/result/tasks/0/ref',
      '/result/tasks/0/taskType',
    ]));
  });
});