import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { openWasm } from '../src/wasm.ts';
import { runAppSuite } from './app-suite.ts';

const entry = createRequire(import.meta.url).resolve('@relate/relate-wasm');
const wasm = new Uint8Array(readFileSync(join(dirname(entry), 'relate_bg.wasm')));

runAppSuite('wasm', () => openWasm({ wasm }));
