import type { CommandDescriptor } from './descriptor.js';

export class CommandRegistry {
  #commands = new Map<string, CommandDescriptor>();

  register(command: CommandDescriptor): void {
    if (this.#commands.has(command.name)) throw new Error(`Duplicate command: ${command.name}`);
    this.#commands.set(command.name, command);
  }

  get(name: string): CommandDescriptor | undefined {
    return this.#commands.get(name);
  }

  list(): readonly CommandDescriptor[] {
    return [...this.#commands.values()].sort((left, right) => left.name.localeCompare(right.name));
  }
}