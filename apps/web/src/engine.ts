import type { Workspace } from '../../../packages/core/src/workspace.ts';
import type { Method, Reply } from './protocol.ts';

export class EngineError extends Error {
  /** Set when the user can fix the problem. */
  readonly issues: string[] | null;
  constructor(message: string, issues: string[] | null) {
    super(message);
    this.issues = issues;
  }
}

const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
const waiting = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
let nextId = 0;
let stopped = false;

worker.onmessage = ({ data }: MessageEvent<Reply>) => {
  const call = waiting.get(data.id);
  waiting.delete(data.id);
  if (data.ok) call?.resolve(data.value);
  else call?.reject(new EngineError(data.message, data.issues));
};

worker.onerror = () => {
  stopped = true;
  for (const call of waiting.values()) call.reject(new EngineError('The audit engine stopped', null));
  waiting.clear();
};

export function call<M extends Method>(method: M, ...args: Parameters<Workspace[M]>): Promise<ReturnType<Workspace[M]>> {
  if (stopped) return Promise.reject(new EngineError('The audit engine stopped', null));
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    waiting.set(id, { resolve: resolve as (value: unknown) => void, reject });
    worker.postMessage({ id, method, args });
  });
}

/** The words to show for any failure: always what happened and what to do next. */
export function explainError(error: unknown): string[] {
  if (error instanceof EngineError && error.issues) return error.issues;
  return ['Unable to finish that. Reload the page and try again. Changes you saved earlier are kept'];
}
