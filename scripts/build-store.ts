import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadStore, SAMPLE_STORE } from '../packages/core/src/index.ts';
import { openNative } from '../packages/core/src/native.ts';

const target = resolve(import.meta.dirname, '../demo/store');
if (existsSync(target)) {
  console.error('demo/store already exists. Move or delete it, then build again.');
  process.exit(1);
}

const db = openNative(target);
loadStore(db, SAMPLE_STORE);
db.checkpoint();
console.log('Built demo/store from the synthetic sample.');
