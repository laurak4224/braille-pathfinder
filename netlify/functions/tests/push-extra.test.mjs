import test from 'node:test';
import assert from 'node:assert/strict';
import { createECDH, randomBytes, createHmac } from 'node:crypto';
import { createHandler, subscriptionID, LIMITS } from '../_push/core.mjs';

function setup() {
  const pair = createECDH('prime256v1'); pair.generateKeys();
  const token = randomBytes(32).toString('base64url');
  const env = { PUSH_ENABLED: 'true', PUSH_ORIGIN: 'https://example.com',
    PUSH_SEND_TOKEN: 'sender-token-with-at-least-32-characters',
    PUSH_STORAGE_SECRET: 'storage-secret-with-at-least-32-characters',
    PUSH_VAPID_PUBLIC_KEY: pair.getPublicKey().toString('base64url'),
    PUSH_VAPID_PRIVATE_KEY: pair.getPrivateKey().toString('base64url'), PUSH_VAPID_SUBJECT: 'mailto:test@example.com' };
  const now = 1800000000000;
  const subscription = i => ({ endpoint: `https://fcm.googleapis.com/fcm/send/token-${i}`,
    keys: { p256dh: env.PUSH_VAPID_PUBLIC_KEY, auth: randomBytes(16).toString('base64url') }, expirationTime: null });
  let state = { version: 1, subscriptions: {}, rates: {} }; let etag = 1;
  const owner = createHmac('sha256', env.PUSH_STORAGE_SECRET).update(`owner:${token}`).digest('hex');
  const store = {
    async getWithMetadata() { return { data: structuredClone(state), etag: String(etag) }; },
    async setJSON(key, value, condition) {
      if (condition.onlyIfMatch !== String(etag)) return { modified: false };
      state = structuredClone(value); etag++; return { modified: true };
    },
  };
  const deps = { env, getStore: async () => store, now: () => now,
    resolve: async () => [{ address: '142.250.1.1', family: 4 }], sendNotification: async () => {} };
  const call = (kind, body) => createHandler(kind, deps)(new Request('https://example.com/test', {
    method: 'POST', headers: { origin: env.PUSH_ORIGIN, 'content-type': 'application/json', authorization: `Bearer ${env.PUSH_SEND_TOKEN}` }, body: JSON.stringify(body),
  }), { ip: '203.0.113.1' });
  const add = (i, expiresAt = now + LIMITS.retention) => {
    const sub = subscription(i); const id = subscriptionID(sub.endpoint);
    state.subscriptions[id] = { subscription: sub, owner, expiresAt, revision: `revision-${i}` };
    return id;
  };
  return { deps, call, subscription, token, add, now, get state() { return state; } };
}

test('500-record registry capacity blocks new records but allows owner renewal', async () => {
  const f = setup();
  for (let i = 0; i < LIMITS.subscriptions; i++) f.add(i);
  const register = i => f.call('subscriptions', { action: 'register', subscription: f.subscription(i), removalToken: f.token });
  assert.equal((await register(501)).status, 429);
  assert.equal((await register(0)).status, 200);
  assert.equal(Object.keys(f.state.subscriptions).length, 500);
});

test('expired record is pruned to make capacity for a new registration', async () => {
  const f = setup();
  for (let i = 0; i < LIMITS.subscriptions; i++) f.add(i, i === 0 ? f.now - 1 : f.now + LIMITS.retention);
  const response = await f.call('subscriptions', { action: 'register', subscription: f.subscription(501), removalToken: f.token });
  assert.equal(response.status, 200);
  assert.equal(Object.keys(f.state.subscriptions).length, 500);
});

test('410 cleanup does not erase a concurrently renewed subscription', async () => {
  const f = setup(); const id = f.add(0);
  f.deps.sendNotification = async () => {
    const renewal = await f.call('subscriptions', { action: 'register', subscription: f.subscription(0), removalToken: f.token });
    assert.equal(renewal.status, 200);
    throw { statusCode: 410 };
  };
  const response = await f.call('send', { ids: [id], notification: { title: 'Reminder', body: 'Review' } });
  assert.equal(response.status, 200);
  assert.ok(f.state.subscriptions[id]);
  assert.notEqual(f.state.subscriptions[id].revision, 'revision-0');
});

test('send transport is never invoked if quota commit fails', async () => {
  const f = setup(); const id = f.add(0); let calls = 0;
  f.deps.getStore = async () => ({
    getWithMetadata: async () => ({ data: structuredClone(f.state), etag: '1' }),
    setJSON: async () => { throw new Error('unavailable'); },
  });
  f.deps.sendNotification = async () => { calls++; };
  const response = await f.call('send', { ids: [id], notification: { title: 'Reminder', body: 'Review' } });
  assert.equal(response.status, 503);
  assert.equal(calls, 0);
});
