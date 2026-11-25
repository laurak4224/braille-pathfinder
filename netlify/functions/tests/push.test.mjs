import test from 'node:test';
import assert from 'node:assert/strict';
import { createECDH, randomBytes } from 'node:crypto';
import { createHandler, endpointURL, publicAddress, pinnedAgent, LIMITS, subscriptionID } from '../_push/core.mjs';

const pair = createECDH('prime256v1'); pair.generateKeys();
const env = {
  PUSH_ENABLED: 'true', PUSH_ORIGIN: 'https://example.com',
  PUSH_SEND_TOKEN: 'server-send-token-at-least-32-characters',
  PUSH_STORAGE_SECRET: 'different-storage-secret-at-least-32-characters',
  PUSH_VAPID_PUBLIC_KEY: pair.getPublicKey().toString('base64url'),
  PUSH_VAPID_PRIVATE_KEY: pair.getPrivateKey().toString('base64url'),
  PUSH_VAPID_SUBJECT: 'mailto:operator@example.com',
};
const token = randomBytes(32).toString('base64url');
const subscription = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/test-token',
  expirationTime: null,
  keys: { p256dh: pair.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') },
};
function fixture(overrides = {}) {
  let state = null; let version = 0;
  const calls = [];
  const store = {
    async getWithMetadata() { return state === null ? null : { data: structuredClone(state), etag: String(version) }; },
    async setJSON(key, value, conditions) {
      if (conditions.onlyIfNew ? state !== null : conditions.onlyIfMatch !== String(version)) return { modified: false };
      state = structuredClone(value); version++;
      return { modified: true, etag: String(version) };
    },
  };
  const deps = { env: { ...env }, getStore: async () => store, now: () => 1800000000000,
    resolve: async () => [{ address: '142.250.1.1', family: 4 }],
    sendNotification: async (...args) => { calls.push(args); }, ...overrides };
  const handlers = Object.fromEntries(['config', 'subscriptions', 'send'].map(kind => [kind, createHandler(kind, deps)]));
  async function request(kind, body, options = {}) {
    const headers = { ...(kind !== 'config' ? { 'content-type': 'application/json', origin: env.PUSH_ORIGIN } : {}),
      ...(kind === 'send' ? { authorization: `Bearer ${env.PUSH_SEND_TOKEN}` } : {}), ...options.headers };
    const req = new Request(`https://example.com/.netlify/functions/push-${kind}`, {
      method: options.method ?? (kind === 'config' ? 'GET' : 'POST'), headers,
      ...(kind !== 'config' ? { body: options.raw ?? JSON.stringify(body) } : {}),
    });
    const res = await handlers[kind](req, options.context ?? { ip: '203.0.113.10' });
    return { status: res.status, headers: res.headers, body: res.status === 405 ? null : await res.json() };
  }
  const register = (extra = {}) => request('subscriptions', { action: 'register', subscription, removalToken: token, ...extra });
  const send = ids => request('send', { ids, notification: { title: 'Reminder', body: 'Review your deadline', url: '/#tracker' } });
  return { request, register, send, calls, deps, store, get state() { return state; }, corrupt(value) { state = value; } };
}

test('disabled configuration is inert; enabled config discloses public key only', async () => {
  const f = fixture();
  const res = await f.request('config');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { enabled: true, publicKey: env.PUSH_VAPID_PUBLIC_KEY });
  assert.equal(res.headers.get('cache-control'), 'no-store');
  f.deps.env.PUSH_ENABLED = 'false';
  assert.deepEqual((await f.request('config')).body, { enabled: false });
  assert.equal((await f.register()).status, 503);
});

test('misconfigured origin, secret, and mismatched VAPID keys fail closed', async () => {
  for (const update of [{ PUSH_ORIGIN: 'http://example.com' }, { PUSH_ORIGIN: 'https://example.com/' },
    { PUSH_STORAGE_SECRET: '' }, { PUSH_VAPID_PRIVATE_KEY: randomBytes(32).toString('base64url') }]) {
    const f = fixture({ env: { ...env, ...update } });
    assert.equal((await f.request('config')).status, 503);
  }
});

test('origin, fetch metadata, trusted IP, content-type, method and sender auth checks', async () => {
  const f = fixture();
  const body = { action: 'register', subscription, removalToken: token };
  for (const headers of [{ origin: 'https://evil.com' }, { origin: '' }, { 'sec-fetch-site': 'cross-site' }, { 'sec-fetch-mode': 'navigate' }]) {
    assert.equal((await f.request('subscriptions', body, { headers })).status, 403);
  }
  assert.equal((await f.request('subscriptions', body, { context: {} })).status, 503);
  assert.equal((await f.request('subscriptions', body, { headers: { 'content-type': 'text/plain' } })).status, 415);
  assert.equal((await f.request('config', undefined, { method: 'OPTIONS' })).status, 405);
  assert.equal((await f.request('send', {}, { headers: { authorization: 'Bearer wrong' } })).status, 401);
  assert.equal((await f.request('send', {}, { headers: { origin: 'https://evil.com' } })).status, 403);
  assert.equal(f.state, null);
});

test('endpoint allowlist rejects SSRF, credentials, ports, queries, fragments and spoofed hostnames', () => {
  const rejected = [
    'http://fcm.googleapis.com/fcm/send/test', 'https://127.0.0.1/test', 'https://[::1]/test',
    'https://fcm.googleapis.com.evil.com/fcm/send/test', 'https://evil.com/fcm/send/test',
    'https://user@fcm.googleapis.com/fcm/send/test', 'https://fcm.googleapis.com:443/fcm/send/test',
    'https://fcm.googleapis.com:8443/fcm/send/test', 'https://fcm.googleapis.com/fcm/send/test?q=x',
    'https://fcm.googleapis.com/fcm/send/test#x', 'https://fcm.googleapis.com./fcm/send/test',
    'https://fcm.googleapis.com/fcm/send/%2Ftest', 'https://fcm.googleapis.com/fcm/send/../test',
  ];
  for (const endpoint of rejected) assert.throws(() => endpointURL(endpoint), endpoint);
  for (const endpoint of [subscription.endpoint, 'https://fcm.googleapis.com/wp/test:token',
    'https://updates.push.services.mozilla.com/wpush/v2/test_token', 'https://web.push.apple.com/Qtest_token']) assert.ok(endpointURL(endpoint));
});

test('DNS guard rejects private, mixed, mapped and documentation answers; pins public IP', async () => {
  for (const ip of ['127.0.0.1', '10.0.0.1', '169.254.169.254', '100.64.1.1', '192.168.0.1', '203.0.113.1', '::1', '::ffff:127.0.0.1', 'fc00::1', 'fe80::1', '2001:db8::1', '2002:7f00:1::1']) assert.equal(publicAddress(ip), false, ip);
  assert.equal(publicAddress('142.250.1.1'), true);
  assert.equal(publicAddress('2606:4700:4700::1111'), true);
  await assert.rejects(pinnedAgent(subscription.endpoint, async () => [{ address: '127.0.0.1', family: 4 }]));
  await assert.rejects(pinnedAgent(subscription.endpoint, async () => [{ address: '142.250.1.1', family: 4 }, { address: '10.0.0.1', family: 4 }]));
  const agent = await pinnedAgent(subscription.endpoint, async () => [{ address: '142.250.1.1', family: 4 }]);
  await new Promise((resolve, reject) => agent.options.lookup('fcm.googleapis.com', {}, (err, ip, family) => {
    if (err) return reject(err);
    assert.equal(ip, '142.250.1.1'); assert.equal(family, 4); resolve();
  }));
  agent.destroy();
});

test('registration validates keys and strict fields before persistence', async () => {
  const f = fixture();
  for (const sub of [{ ...subscription, keys: { ...subscription.keys, auth: 'wrong' } },
    { ...subscription, keys: { ...subscription.keys, p256dh: Buffer.alloc(65).toString('base64url') } },
    { ...subscription, expirationTime: 1 }, { ...subscription, extra: true }]) {
    assert.equal((await f.register({ subscription: sub })).status, 400);
  }
  assert.equal((await f.register({ removalToken: 'short' })).status, 400);
  assert.equal(f.state, null);
});

test('owner token protects updates/removal; successful removal persists; tokens are hashed', async () => {
  const f = fixture();
  const registered = await f.register(); assert.equal(registered.status, 200);
  const id = registered.body.id;
  assert.equal(id, subscriptionID(subscription.endpoint));
  assert.ok(!JSON.stringify(f.state).includes(token));
  assert.equal((await f.register({ removalToken: randomBytes(32).toString('base64url') })).status, 403);
  assert.equal((await f.request('subscriptions', { action: 'remove', id, removalToken: randomBytes(32).toString('base64url') })).status, 403);
  assert.equal((await f.request('subscriptions', { action: 'remove', id, removalToken: token })).status, 200);
  assert.equal(f.state.subscriptions[id], undefined);
  assert.equal((await f.request('subscriptions', { action: 'remove', id, removalToken: token })).status, 200);
});

test('per-IP atomic quotas survive parallel requests', async () => {
  const f = fixture();
  for (let i = 0; i < 19; i++) assert.equal((await f.register()).status, 200);
  const statuses = await Promise.all([f.register(), f.register()]);
  assert.deepEqual(statuses.map(r => r.status).sort(), [200, 429]);
  assert.equal(f.state.rates['registration-global'].count, 20);
});

test('storage read/write failure, corrupt state, CAS contention and old SDK result fail closed', async () => {
  for (const store of [
    { getWithMetadata: async () => { throw new Error('secret backend detail'); } },
    { getWithMetadata: async () => null, setJSON: async () => { throw new Error('secret'); } },
    { getWithMetadata: async () => null, setJSON: async () => ({ modified: false }) },
    { getWithMetadata: async () => null, setJSON: async () => undefined },
    { getWithMetadata: async () => ({ data: { version: 9 }, etag: 'x' }) },
  ]) {
    const f = fixture({ getStore: async () => store });
    assert.equal((await f.register()).status, 503);
    assert.equal((await f.send([subscriptionID(subscription.endpoint)])).status, 503);
    assert.equal(f.calls.length, 0);
  }
});

test('streaming body, notification size, duplicate IDs and same-origin click URL bounds', async () => {
  const f = fixture();
  assert.equal((await f.request('subscriptions', {}, { raw: 'x'.repeat(LIMITS.body + 1) })).status, 413);
  assert.equal((await f.request('subscriptions', {}, { raw: '{' })).status, 400);
  const id = subscriptionID(subscription.endpoint);
  const good = { title: 'Reminder', body: 'Review' };
  for (const url of ['https://evil.com', '//evil.com', '/\\evil.com', '/\nsecret']) {
    assert.equal((await f.request('send', { ids: [id], notification: { ...good, url } })).status, 400);
  }
  assert.equal((await f.send([id, id])).status, 400);
  assert.equal((await f.send(Array.from({ length: 21 }, (_, i) => i.toString(16).padStart(64, '0')))).status, 400);
  assert.equal((await f.request('send', { ids: [id], notification: { title: '😀'.repeat(51), body: '😀'.repeat(300) } })).status, 400);
  assert.equal((await f.request('send', { ids: [id], notification: { title: '漢'.repeat(100), body: '漢'.repeat(600) } })).status, 413);
  assert.equal(f.calls.length, 0);
});

test('authenticated sends use VAPID, bounded options and accepted/not_found statuses', async () => {
  const f = fixture(); const reg = await f.register(); const id = reg.body.id;
  const result = await f.send([id, 'a'.repeat(64)]);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.results, [{ id, status: 'accepted' }, { id: 'a'.repeat(64), status: 'not_found' }]);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0][2].TTL, 3600);
  assert.equal(f.calls[0][2].timeout, 5000);
  assert.equal(f.calls[0][2].vapidDetails.privateKey, env.PUSH_VAPID_PRIVATE_KEY);
  assert.equal(f.state.rates['send-global'].count, 2);
});

test('hourly send recipient quota is persisted before any network call', async () => {
  const f = fixture(); const reg = await f.register(); const id = reg.body.id;
  f.state.rates['send-global'] = { window: Math.floor(f.deps.now() / 3600000), count: 200 };
  assert.equal((await f.send([id])).status, 429);
  assert.equal(f.calls.length, 0);
});

test('410 deletes stale subscriptions; transient/DNS failure leaves subscriptions intact', async () => {
  for (const code of [410, 404, 500]) {
    const f = fixture({ sendNotification: async () => { throw { statusCode: code, body: 'sensitive endpoint' }; } });
    const id = (await f.register()).body.id;
    const res = await f.send([id]);
    assert.equal(res.body.results[0].status, code === 500 ? 'failed' : 'expired');
    assert.equal(Boolean(f.state.subscriptions[id]), code === 500);
    assert.ok(!JSON.stringify(res).includes('sensitive'));
  }
  const f = fixture({ resolve: async () => [{ address: '10.0.0.1', family: 4 }] });
  const id = (await f.register()).body.id;
  assert.equal((await f.send([id])).body.results[0].status, 'failed');
  assert.equal(f.calls.length, 0);
  assert.ok(f.state.subscriptions[id]);
});

test('expiry and capacity are bounded, expired entries are pruned', async () => {
  const f = fixture(); const id = (await f.register()).body.id;
  f.deps.now = () => 1800000000000 + LIMITS.retention + 1;
  assert.equal((await f.send([id])).body.results[0].status, 'not_found');
  assert.equal(f.calls.length, 0);
});
