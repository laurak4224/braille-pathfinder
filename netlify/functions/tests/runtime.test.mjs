import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

// Exercise actual installed SDK interoperability in a fresh process: mocks alone
// cannot detect CommonJS/ESM named-export failures. No network or secrets needed.
test('runtime and real entrypoints import with installed SDKs and default to disabled', () => {
  const runtime = new URL('../_push/runtime.mjs', import.meta.url).href;
  const entries = ['push-config', 'push-subscriptions', 'push-send'].map(name => new URL(`../${name}.mjs`, import.meta.url).href);
  const script = `
    import assert from 'node:assert/strict';
    const runtime = await import(${JSON.stringify(runtime)});
    assert.equal(typeof runtime.handlerFor, 'function');
    const modules = await Promise.all(${JSON.stringify(entries)}.map(url => import(url)));
    for (const mod of modules) assert.equal(typeof mod.default, 'function');
    const response = await modules[0].default(new Request('https://example.com/.netlify/functions/push-config'));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { enabled: false });
    for (const mod of modules.slice(1)) {
      const result = await mod.default(new Request('https://example.com/test', { method: 'POST' }));
      assert.equal(result.status, 503);
    }
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    env: { ...process.env, PUSH_ENABLED: 'false' }, encoding: 'utf8', timeout: 10000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, `Runtime import failed:\n${result.stderr}`);
});
