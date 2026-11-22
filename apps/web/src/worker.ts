import wasmUrl from '@relate/relate-wasm/relate_bg.wasm?url';
import { createSlots } from '../../../packages/core/src/slots.ts';
import { InputError } from '../../../packages/core/src/validate.ts';
import { openWasm } from '../../../packages/core/src/wasm.ts';
import { Workspace, type Persistence, type Saved } from '../../../packages/core/src/workspace.ts';
import { METHODS, type Method, type Reply, type Request } from './protocol.ts';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const open = (uri?: string) => openWasm({ wasm: new URL(wasmUrl, self.location.href), uri });

async function connect(): Promise<Persistence> {
  const scratch = await open();
  const inMemory = async (saved: Saved) => createSlots([await open(), await open()], scratch, saved);

  if (new URLSearchParams(self.location.search).has('demo')) return inMemory('memory');
  if (!navigator.storage?.getDirectory) return inMemory('unavailable');

  // On a reload the previous worker can hold the lock for a moment.
  for (let attempt = 0; ; attempt++) {
    try {
      const first = await open('opfs://audit-a');
      const second = await open('opfs://audit-b');
      return createSlots([first, second], scratch, 'device');
    } catch (error) {
      const locked = /locked/i.test(String(error));
      if (!locked) return inMemory('unavailable');
      if (attempt >= 6) return inMemory('locked');
      await wait(250);
    }
  }
}

const ready = connect().then((persistence) => new Workspace(persistence));
// Reported on the first call instead of as an unhandled rejection.
ready.catch(() => {});

self.onmessage = async ({ data }: MessageEvent<Request>) => {
  let reply: Reply;
  try {
    if (!METHODS.includes(data.method)) throw new Error(`Unknown method ${data.method}`);
    const workspace = await ready;
    const run = workspace[data.method as Method] as (...args: unknown[]) => unknown;
    reply = { id: data.id, ok: true, value: run.apply(workspace, data.args) };
  } catch (error) {
    reply = {
      id: data.id,
      ok: false,
      issues: error instanceof InputError ? error.issues : null,
      message: error instanceof Error ? error.message : String(error),
    };
  }
  self.postMessage(reply);
};
