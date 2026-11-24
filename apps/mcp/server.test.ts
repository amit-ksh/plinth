import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { defaultState, SAMPLE_STORE } from '../../packages/core/src/index.ts';

const root = resolve(import.meta.dirname, '../..');
const FLAGS = ['--experimental-strip-types', '--no-warnings'];

async function connected<T>(store: string | undefined, work: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ name: 'test', version: '1' });
  const args = [...FLAGS, join(root, 'apps/mcp/server.ts'), ...(store ? [store] : [])];
  await client.connect(new StdioClientTransport({ command: process.execPath, args }));
  try {
    return await work(client);
  } finally {
    await client.close();
  }
}

async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args });
  const text = (result.content as { text: string }[])[0].text;
  return { error: result.isError === true, text, value: result.isError ? null : JSON.parse(text) };
}

const fingerprint = (dir: string) =>
  readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((f) => f.isFile())
    .map((f) => join(f.parentPath, f.name))
    .sort()
    .map((path) => readFileSync(path).toString('base64'));

test('five read-only tools answer over stdio and leave the store untouched', async () => {
  const before = fingerprint(join(root, 'demo/store'));
  await connected(undefined, async (client) => {
    const { tools } = await client.listTools();
    assert.deepEqual(
      tools.map((t) => t.name).sort(),
      ['audit_store', 'check_promotion', 'check_variant', 'explain_leak', 'simulate_settings'],
    );
    assert.ok(tools.every((t) => t.annotations?.readOnlyHint === true));

    const audit = await call(client, 'audit_store');
    assert.equal(audit.value.counts.leak, 2);
    assert.equal(audit.value.leaks[0].id, 'jacket');
    assert.equal(audit.value.leaks[0].loses, '$5.00');

    const explained = await call(client, 'explain_leak', { product: 'jacket' });
    assert.equal(explained.value.whyTheyCombine.length, 3);
    const simulated = await call(client, 'simulate_settings', { product: 'jacket', fixId: explained.value.fixes[0].fixId });
    assert.equal(simulated.value.stateAfter, 'clear_in_model');
    assert.equal(simulated.value.worstAfter.keeps, '$68.00');

    assert.equal((await call(client, 'check_variant', { search: 'boots' })).value.products[0].state, 'leak');
    assert.ok((await call(client, 'check_promotion', { promotion: '70% off winter' })).value.wouldLeak > 0);

    assert.ok((await call(client, 'explain_leak', { product: 'nope' })).error);
    assert.ok((await call(client, 'check_promotion', { promotion: 'buy 2 get 1' })).error);
  });
  assert.deepEqual(fingerprint(join(root, 'demo/store')), before);
});

test('a browser backup becomes a store the server can read', async () => {
  const temp = mkdtempSync(join(tmpdir(), 'plinth-mcp-'));
  try {
    const app = defaultState(false);
    app.settings.storeName = 'Imported shop';
    const backup = join(temp, 'backup.json');
    writeFileSync(backup, JSON.stringify({ format: 'discount-audit', version: 1, store: SAMPLE_STORE, app }));
    const target = join(temp, 'nested', 'store');
    const run = () =>
      execFileSync(process.execPath, [...FLAGS, join(root, 'scripts/import-store.ts'), backup, target], { stdio: 'pipe' });
    run();
    assert.throws(run, 'it must not overwrite a store');
    await connected(target, async (client) => {
      assert.equal((await call(client, 'audit_store')).value.store, 'Imported shop');
    });
  } finally {
    rmSync(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test('the desktop agent file is read directly, and each call sees the latest save', async () => {
  const temp = mkdtempSync(join(tmpdir(), 'plinth-mcp-'));
  try {
    const file = join(temp, 'plinth-audit.json');
    const app = defaultState(false);
    app.settings.storeName = 'Desktop shop';
    const write = (store: typeof SAMPLE_STORE) => writeFileSync(file, JSON.stringify({ format: 'discount-audit', version: 1, store, app }));
    write(SAMPLE_STORE);
    await connected(file, async (client) => {
      const first = (await call(client, 'audit_store')).value;
      assert.equal(first.store, 'Desktop shop');
      assert.equal(first.counts.leak, 2);
      // The desktop app saves again: BUNDLE20 removed, so the jacket's stack is gone.
      write({ ...SAMPLE_STORE, discounts: SAMPLE_STORE.discounts.filter((d) => d.id !== 'BUNDLE20') });
      assert.equal((await call(client, 'audit_store')).value.counts.leak, 1);
    });
  } finally {
    rmSync(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
