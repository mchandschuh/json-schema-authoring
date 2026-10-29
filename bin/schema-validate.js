#!/usr/bin/env node

import { main } from '../dist/cli/main.js';

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : 'schema-validate failed');
  process.exitCode = 1;
}