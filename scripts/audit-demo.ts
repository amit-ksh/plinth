import { resolve } from 'node:path';
import { audit, explainStack, SAMPLE_SCENARIO } from '../packages/core/src/index.ts';
import { openNative } from '../packages/core/src/native.ts';

const args = process.argv.slice(2);
const path = args.find((a) => !a.startsWith('--')) ?? resolve(import.meta.dirname, '../demo/store');
const db = openNative(path, { readOnly: true });
const result = audit(db, SAMPLE_SCENARIO);

if (args.includes('--json')) {
  console.log(JSON.stringify(result));
} else {
  const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
  const { leak, unknown, clear_in_model } = result.counts;
  console.log(`Leak: ${leak}   Unknown: ${unknown}   Clear in model: ${clear_in_model}\n`);
  for (const v of result.variants) {
    if (v.state === 'leak' && v.worst) {
      const { stack, net, cost, qty } = v.worst;
      console.log(`LEAK     ${v.title}: ${stack.join(' + ') || 'list price'}`);
      console.log(`         keeps ${money.format(net / 100)}, costs ${money.format(cost / 100)}, quantity ${qty}`);
      for (const pair of explainStack(db, stack)) console.log(`         ${pair.left} + ${pair.right}: ${pair.rule}`);
    } else if (v.state === 'unknown') {
      console.log(`UNKNOWN  ${v.title}: ${v.unknown.join(', ').replaceAll('_', ' ')}`);
    }
  }
  console.log('\nModeled Shopify rules, not yet verified against a real checkout.');
}
