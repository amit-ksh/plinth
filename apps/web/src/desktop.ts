// The desktop app (apps/desktop, Tauri) adds an agent folder: after every change the audit is written there,
// so a local AI agent's MCP server always reads the latest version. In a browser, none of this runs.
import { useEffect, useState } from 'react';
import type { Snapshot } from '../../../packages/core/src/workspace.ts';
import { call } from './engine.ts';

type Invoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;
const invoke = (globalThis as { __TAURI_INTERNALS__?: { invoke?: Invoke } }).__TAURI_INTERNALS__?.invoke;

export const IS_DESKTOP = typeof invoke === 'function';

export interface AgentStatus {
  file: string | null;
  writtenAt: number | null;
  error: string | null;
}

let status: AgentStatus = { file: null, writtenAt: null, error: null };
const listeners = new Set<(s: AgentStatus) => void>();
const set = (next: Partial<AgentStatus>) => {
  status = { ...status, ...next };
  for (const l of listeners) l(status);
};

async function writeNow(): Promise<void> {
  if (!invoke || !status.file) return;
  try {
    await invoke('write_agent_file', { json: await call('backup') });
    set({ writtenAt: Date.now(), error: null });
  } catch (error) {
    set({ error: String(error) });
  }
}

if (invoke) {
  void invoke('agent_file').then((file) => set({ file: (file as string | null) ?? null }));
}

export const agentFolder = {
  async choose(): Promise<void> {
    const file = (await invoke!('pick_agent_folder')) as string | null;
    if (!file) return;
    set({ file, error: null });
    await writeNow();
  },
  async stop(): Promise<void> {
    await invoke!('clear_agent_folder');
    set({ file: null, writtenAt: null, error: null });
  },
  writeNow,
};

export function useAgentStatus(): AgentStatus {
  const [s, setS] = useState(status);
  useEffect(() => {
    listeners.add(setS);
    return () => void listeners.delete(setS);
  }, []);
  return s;
}

/** Writes the agent file whenever the audit changes, a moment after the last change. */
export function useAgentSync(data: Snapshot | null): void {
  useEffect(() => {
    if (!IS_DESKTOP || !data) return;
    const timer = setTimeout(() => void writeNow(), 400);
    return () => clearTimeout(timer);
  }, [data]);
}
