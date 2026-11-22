import type { Workspace } from '../../../packages/core/src/workspace.ts';

/** Everything the screens can ask the worker to do. The screens never send Cypher. */
export const METHODS = [
  'snapshot', 'product', 'parsePromotion', 'checkPromotion', 'saveDiscount', 'deleteDiscount', 'setCost',
  'saveSettings', 'addToChecklist', 'removeFromChecklist', 'completeChecklistItem', 'readCsv', 'useImport',
  'resetSample', 'undo', 'backup', 'restore', 'report',
] as const satisfies readonly (keyof Workspace)[];

export type Method = (typeof METHODS)[number];

export interface Request {
  id: number;
  method: Method;
  args: unknown[];
}

export type Reply =
  | { id: number; ok: true; value: unknown }
  | { id: number; ok: false; issues: string[] | null; message: string };
