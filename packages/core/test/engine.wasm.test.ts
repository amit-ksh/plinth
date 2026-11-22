import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { openWasm } from '../src/wasm.ts';
import { runEngineSuite } from './suite.ts';

// Runs in its own process. Native and WASM are never loaded together (ADR: one unexplained segfault).
const entry = createRequire(import.meta.url).resolve('@relate/relate-wasm');
const wasm = new Uint8Array(readFileSync(join(dirname(entry), 'relate_bg.wasm')));

runEngineSuite('wasm', () => openWasm({ wasm }));
