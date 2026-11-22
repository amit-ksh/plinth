// Turns a backup from the browser app into a directory store for the MCP server.
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { openNative } from '../packages/core/src/native.ts';
import * as Q from '../packages/core/src/queries.ts';
import { loadStore } from '../packages/core/src/store.ts';
import { InputError } from '../packages/core/src/validate.ts';
import { readBackup } from '../packages/core/src/workspace.ts';

const [from, to] = process.argv.slice(2);

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

if (!from || !to) fail('Usage: npm run store:import -- <backup.json> <new directory>');
if (!existsSync(from)) fail(`${from} does not exist. Download a backup from the app first.`);
if (existsSync(to)) fail(`${to} already exists. Choose a new directory, or move that one away.`);

try {
  const { store, app } = readBackup(readFileSync(from, 'utf8'));
  mkdirSync(dirname(resolve(to)), { recursive: true });
  const db = openNative(resolve(to));
  loadStore(db, store);
  db.query(Q.WRITE_APP, { json: JSON.stringify(app) });
  db.checkpoint();
  console.log(`Created ${to} with ${store.variants.length} products and ${store.discounts.length} discounts.`);
} catch (error) {
  if (error instanceof InputError) fail(error.issues.join('\n'));
  throw error;
}
