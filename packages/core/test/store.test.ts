import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

const root = resolve(import.meta.dirname, '../../..');

// A child process, so Windows releases the store's files before cleanup.
const auditStore = (path: string) =>
  JSON.parse(
    execFileSync(process.execPath, ['--experimental-strip-types', '--no-warnings', join(root, 'scripts/audit-demo.ts'), path, '--json'], {
      encoding: 'utf8',
    }),
  );

const files = (dir: string) =>
  readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((f) => f.isFile())
    .map((f) => join(f.parentPath, f.name))
    .sort()
    .map((path) => readFileSync(path).toString('base64'));

const EXPECTED = { leak: 2, thin: 0, unknown: 1, clear_in_model: 47 };

test('reading the committed store does not change it', () => {
  const store = join(root, 'demo/store');
  const before = files(store);
  assert.deepEqual(auditStore(store).counts, EXPECTED);
  assert.deepEqual(files(store), before);
});

for (const autocrlf of ['true', 'false', 'input']) {
  test(`store survives a clone with core.autocrlf=${autocrlf}`, () => {
    const temp = mkdtempSync(join(tmpdir(), 'stackleak-clone-'));
    try {
      const source = join(temp, 'source');
      const clone = join(temp, 'clone');
      cpSync(join(root, 'demo'), join(source, 'demo'), { recursive: true });
      cpSync(join(root, '.gitattributes'), join(source, '.gitattributes'));
      cpSync(join(root, '.gitignore'), join(source, '.gitignore'));

      const git = (...args: string[]) =>
        execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', ...args], { stdio: 'pipe' });
      git('init', '-q', source);
      git('-C', source, '-c', `core.autocrlf=${autocrlf}`, 'add', '-A');
      git('-C', source, 'commit', '-qm', 'store');
      git('-c', `core.autocrlf=${autocrlf}`, 'clone', '-q', source, clone);

      assert.deepEqual(auditStore(join(clone, 'demo/store')).counts, EXPECTED);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });
}
