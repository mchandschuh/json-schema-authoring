import { readFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverCommands } from '../core/cli/discover.js';
import { help } from './commands/validate.command.js';

const entrypointDirectory = dirname(fileURLToPath(import.meta.url));
const commandsPath = resolve(entrypointDirectory, 'commands');
const packagePath = resolve(entrypointDirectory, '../../package.json');
const commandSuffix = entrypointDirectory.endsWith(`${sep}src${sep}cli`) ? '.command.ts' : '.command.js';

export async function main(args: readonly string[] = process.argv.slice(2)): Promise<number> {
  const registry = await discoverCommands(commandsPath, commandSuffix);
  const [first] = args;
  if (!first || first === '--help' || first === '-h') return help();
  if (first === '--version' || first === '-v') {
    const packageJson = JSON.parse(await readFile(packagePath, 'utf8')) as { version: string };
    console.log(packageJson.version);
    return 0;
  }
  const command = registry.get('validate');
  if (!command) throw new Error('The validate command was not discovered.');
  return command.handler(args);
}