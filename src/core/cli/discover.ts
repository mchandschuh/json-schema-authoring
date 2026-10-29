import { readdir } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CommandRegistry } from './registry.js';
import { isCommandDescriptor, type CommandModule } from './descriptor.js';

async function filesUnder(directory: string, suffix: string): Promise<string[]> {
  const entries = (await readdir(directory, { withFileTypes: true }))
    .sort((left, right) => left.name.localeCompare(right.name));
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesUnder(path, suffix));
    else if (entry.isFile() && entry.name.endsWith(suffix)) files.push(path);
  }
  return files.sort((left, right) => relative(directory, left).localeCompare(relative(directory, right)));
}

export async function discoverCommands(directory: string, suffix = '.command.js'): Promise<CommandRegistry> {
  const registry = new CommandRegistry();
  for (const path of await filesUnder(resolve(directory), suffix)) {
    const loaded = await import(pathToFileURL(path).href) as CommandModule;
    const descriptor = loaded.default ?? loaded.command;
    if (!isCommandDescriptor(descriptor)) throw new Error(`Invalid command descriptor: ${path}`);
    registry.register(descriptor);
  }
  return registry;
}