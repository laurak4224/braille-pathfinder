import { createHash, createHmac, timingSafeEqual, ECDH, createECDH, randomUUID } from 'node:crypto';
import { isIP, BlockList } from 'node:net';
import { Agent } from 'node:https';

export const LIMITS = Object.freeze({ body: 16384, payload: 2048, batch: 20, subscriptions: 500, retention: 90 * 86400000 });
const STATE_KEY = 'registry-v1';
const PROVIDERS = new Set(['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com']);
const blocked = new BlockList();
for (const [ip, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 3]]) blocked.addSubnet(ip, prefix, 'ipv4');
// Only globally routed IPv6 unicast, excluding documentation and transition ranges.
blocked.addSubnet('2001:db8::', 32, 'ipv6');
blocked.addSubnet('2001::', 32, 'ipv6');
blocked.addSubnet('2002::', 16, 'ipv6');

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new HttpError(status, message); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function exact(value, fields) {
  if (!object(value) || Object.keys(value).some(key => !fields.includes(key))) fail(400, 'Invalid fields');
}
function b64(value, size) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) fail(400, 'Invalid key encoding');
  const bytes = Buffer.from(value, 'base64url');
  if (bytes.length !== size || bytes.toString('base64url') !== value) fail(400, 'Invalid key length');
  return bytes;
}
function equal(a, b) {
  const x = Buffer.from(a ?? ''); const y = Buffer.from(b ?? '');
  return x.length === y.length && timingSafeEqual(x, y);
}
export const subscriptionID = endpoint => createHash('sha256').update(endpoint).digest('hex');
export function endpointURL(endpoint) {
  if (typeof endpoint !== 'string' || endpoint.length > 2048) fail(400, 'Invalid endpoint');
  let url;
  try { url = new URL(endpoint); } catch { fail(400, 'Invalid endpoint'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash ||
      !PROVIDERS.has(url.hostname) || url.href !== endpoint || url.pathname.length < 2 ||
      !/^\/[A-Za-z0-9_:./~%-]+$/.test(url.pathname) || /%|\/\//.test(url.pathname)) fail(400, 'Unsupported push endpoint');
  if (url.hostname === 'fcm.googleapis.com' && !/^\/(fcm\/send|wp)\/[A-Za-z0-9_:-]+$/.test(url.pathname)) fail(400, 'Unsupported FCM endpoint');
  if (url.hostname === 'updates.push.services.mozilla.com' && !/^\/wpush\/v2\/[A-Za-z0-9_-]+$/.test(url.pathname)) fail(400, 'Unsupported Mozilla endpoint');
  return url;
}
export function validateSubscription(value) {
  exact(value, ['endpoint', 'keys', 'expirationTime']);
  endpointURL(value.endpoint);
  exact(value.keys, ['p256dh', 'auth']);
  const pub = b64(value.keys.p256dh, 65);
  try { ECDH.convertKey(pub, 'prime256v1'); } catch { fail(400, 'Invalid subscription public key'); }
  if (pub[0] !== 4) fail(400, 'Uncompressed key required');
  b64(value.keys.auth, 16);
  if (value.expirationTime !== undefined && value.expirationTime !== null &&
      (!Number.isSafeInteger(value.expirationTime) || value.expirationTime <= 0)) fail(400, 'Invalid expirationTime');
  return { endpoint: value.endpoint, keys: { p256dh: value.keys.p256dh, auth: value.keys.auth }, expirationTime: value.expirationTime ?? null };
}
function configuration(env) {
  if (env.PUSH_ENABLED !== 'true') fail(503, 'Notifications disabled');
  let origin;
  try { origin = new URL(env.PUSH_ORIGIN); } catch { fail(503, 'Notifications misconfigured'); }
  if (origin.protocol !== 'https:' || origin.origin !== env.PUSH_ORIGIN || origin.username || origin.password) fail(503, 'Notifications misconfigured');
  if (!env.PUSH_SEND_TOKEN || env.PUSH_SEND_TOKEN.length < 32 || !env.PUSH_STORAGE_SECRET || env.PUSH_STORAGE_SECRET.length < 32 || env.PUSH_SEND_TOKEN === env.PUSH_STORAGE_SECRET) fail(503, 'Notifications misconfigured');
  try {
    const privateKey = b64(env.PUSH_VAPID_PRIVATE_KEY, 32);
    const pub = b64(env.PUSH_VAPID_PUBLIC_KEY, 65);
    const pair = createECDH('prime256v1'); pair.setPrivateKey(privateKey);
    if (!pair.getPublicKey().equals(pub)) throw new Error('mismatched keys');
    const subject = new URL(env.PUSH_VAPID_SUBJECT);
    if (!['https:', 'mailto:'].includes(subject.protocol) || subject.username || subject.password) throw new Error('subject');
  } catch { fail(503, 'Notifications misconfigured'); }
  return { origin: origin.origin, publicKey: env.PUSH_VAPID_PUBLIC_KEY };
}
function browserOrigin(request, origin, required) {
  const value = request.headers.get('origin');
  if ((required && value !== origin) || (value !== null && value !== origin)) fail(403, 'Origin denied');
  const site = request.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') fail(403, 'Cross-site request denied');
  if (request.headers.get('sec-fetch-mode') === 'navigate') fail(403, 'Navigation denied');
}
async function jsonBody(request) {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('content-type') ?? '')) fail(415, 'application/json required');
  if (request.headers.has('content-encoding') && request.headers.get('content-encoding') !== 'identity') fail(415, 'Compressed bodies unsupported');
  const length = request.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > LIMITS.body)) fail(413, 'Request too large');
  const reader = request.body?.getReader();
  if (!reader) fail(400, 'JSON body required');
  const chunks = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > LIMITS.body) { await reader.cancel(); fail(413, 'Request too large'); }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
  catch { fail(400, 'Invalid JSON'); }
}
function response(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...(status === 429 ? { 'Retry-After': '3600' } : {}) } });
}
const mac = (env, value) => createHmac('sha256', env.PUSH_STORAGE_SECRET).update(value).digest('hex');
function tokenHash(env, token) { b64(token, 32); return mac(env, `owner:${token}`); }
function validID(id) { return typeof id === 'string' && /^[a-f0-9]{64}$/.test(id); }
function validateState(state) {
  if (!object(state) || state.version !== 1 || !object(state.subscriptions) || !object(state.rates) ||
      Object.keys(state.subscriptions).length > LIMITS.subscriptions || Object.keys(state.rates).length > 258) fail(503, 'Storage unavailable');
  for (const [id, record] of Object.entries(state.subscriptions)) {
    if (!validID(id) || !object(record) || !/^[a-f0-9]{64}$/.test(record.owner) || !Number.isSafeInteger(record.expiresAt) || typeof record.revision !== 'string' || record.revision.length > 64) fail(503, 'Storage unavailable');
    try { validateSubscription(record.subscription); } catch { fail(503, 'Storage unavailable'); }
    if (subscriptionID(record.subscription.endpoint) !== id) fail(503, 'Storage unavailable');
  }
  for (const rate of Object.values(state.rates)) {
    if (!object(rate) || !Number.isSafeInteger(rate.window) || !Number.isSafeInteger(rate.count) || rate.count < 0) fail(503, 'Storage unavailable');
  }
}
// A single bounded strong-consistency document permits atomic registry + quota updates.
// Any CAS conflict retries at most four times, then fails closed (no push request).
async function transaction(store, now, change) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const entry = await store.getWithMetadata(STATE_KEY, { type: 'json', consistency: 'strong' });
    const state = entry ? entry.data : { version: 1, subscriptions: {}, rates: {} };
    validateState(state);
    if (entry && (typeof entry.etag !== 'string' || !entry.etag)) fail(503, 'Storage unavailable');
    for (const [id, record] of Object.entries(state.subscriptions)) if (record.expiresAt <= now) delete state.subscriptions[id];
    const window = Math.floor(now / 3600000);
    for (const [key, rate] of Object.entries(state.rates)) if (rate.window !== window) delete state.rates[key];
    const result = change(state, window);
    const written = await store.setJSON(STATE_KEY, state, entry ? { onlyIfMatch: entry.etag } : { onlyIfNew: true });
    if (written?.modified === true) return result;
    if (written?.modified !== false) fail(503, 'Storage unavailable');
  }
  fail(503, 'Storage busy');
}
function rate(state, window, key, max, amount = 1) {
  if (!state.rates[key] && Object.keys(state.rates).length >= 258) fail(429, 'Rate capacity reached');
  const current = state.rates[key]?.count ?? 0;
  if (current + amount > max) fail(429, 'Rate limit exceeded');
  state.rates[key] = { window, count: current + amount };
}
function payloadBody(value, origin) {
  exact(value, ['title', 'body', 'url', 'tag']);
  const result = {};
  for (const [field, max] of [['title', 100], ['body', 600], ['tag', 64]]) {
    const text = value[field];
    if (field === 'tag' && text === undefined) continue;
    if (typeof text !== 'string' || !text.trim() || text.length > max || /[\u0000-\u001f\u007f]/.test(text)) fail(400, `Invalid ${field}`);
    result[field] = text;
  }
  const path = value.url ?? '/';
  if (typeof path !== 'string' || path.length > 512 || !path.startsWith('/') || path.startsWith('//') || /[\\\u0000-\u0020\u007f]/.test(path)) fail(400, 'Invalid notification URL');
  const url = new URL(path, origin);
  if (url.origin !== origin) fail(400, 'Invalid notification URL');
  result.url = url.pathname + url.search + url.hash;
  const payload = JSON.stringify(result);
  if (Buffer.byteLength(payload) > LIMITS.payload) fail(413, 'Payload too large');
  return payload;
}
export function publicAddress(address) {
  const family = isIP(address);
  if (family === 4) return !blocked.check(address, 'ipv4');
  if (family === 6) return /^[23][0-9a-f]{3}:/i.test(address) && !blocked.check(address, 'ipv6');
  return false;
}
export async function pinnedAgent(endpoint, resolve) {
  const url = endpointURL(endpoint);
  const answers = await resolve(url.hostname, { all: true, verbatim: true });
  if (!Array.isArray(answers) || !answers.length || answers.length > 32 || answers.some(a => !publicAddress(a.address) || isIP(a.address) !== a.family)) fail(503, 'Push DNS unavailable');
  const chosen = answers[0];
  return new Agent({ keepAlive: false, maxSockets: 1, lookup(host, options, callback) {
    if (host !== url.hostname) return callback(new Error('Unexpected DNS hostname'));
    if (options?.all) callback(null, [chosen]);
    else callback(null, chosen.address, chosen.family);
  } });
}
export function createHandler(kind, deps) {
  return async (request, context = {}) => {
    try {
      const env = deps.env ?? process.env;
      if (kind === 'config' && env.PUSH_ENABLED !== 'true') return response(200, { enabled: false });
      const config = configuration(env);
      const method = kind === 'config' ? 'GET' : 'POST';
      if (request.method !== method) return new Response(null, { status: 405, headers: { Allow: method, 'Cache-Control': 'no-store' } });
      browserOrigin(request, config.origin, kind === 'subscriptions');
      if (kind === 'config') return response(200, { enabled: true, publicKey: config.publicKey });
      if (kind === 'send') {
        if (!equal(request.headers.get('authorization'), `Bearer ${env.PUSH_SEND_TOKEN}`)) fail(401, 'Unauthorized');
      }
      const body = await jsonBody(request);
      const now = (deps.now ?? Date.now)();
      const store = await deps.getStore();
      if (kind === 'subscriptions') {
        exact(body, ['action', 'subscription', 'id', 'removalToken']);
        const owner = tokenHash(env, body.removalToken);
        if (!['register', 'remove'].includes(body.action)) fail(400, 'Invalid action');
        const ip = context.ip;
        if (!isIP(ip ?? '')) fail(503, 'Trusted client IP unavailable');
        const client = mac(env, `ip:${ip}`);
        let sub; let id;
        if (body.action === 'register') {
          if (body.id !== undefined) fail(400, 'Unexpected id');
          sub = validateSubscription(body.subscription); id = subscriptionID(sub.endpoint);
          if (sub.expirationTime !== null && sub.expirationTime <= now) fail(400, 'Expired subscription');
        } else {
          if (!validID(body.id) || body.subscription !== undefined) fail(400, 'Invalid removal');
          id = body.id;
        }
        await transaction(store, now, (state, window) => {
          rate(state, window, 'registration-global', 200);
          rate(state, window, `ip:${client}`, 20);
          const existing = state.subscriptions[id];
          if (existing && !equal(existing.owner, owner)) fail(403, 'Ownership token mismatch');
          if (body.action === 'remove') delete state.subscriptions[id];
          else {
            if (!existing && Object.keys(state.subscriptions).length >= LIMITS.subscriptions) fail(429, 'Subscription capacity reached');
            state.subscriptions[id] = { subscription: sub, owner, expiresAt: Math.min(now + LIMITS.retention, sub.expirationTime ?? Infinity), revision: (deps.uuid ?? randomUUID)() };
          }
        });
        return response(200, body.action === 'register' ? { id, expiresInDays: 90 } : { removed: true });
      }
      exact(body, ['ids', 'notification']);
      if (!Array.isArray(body.ids) || !body.ids.length || body.ids.length > LIMITS.batch || body.ids.some(id => !validID(id)) || new Set(body.ids).size !== body.ids.length) fail(400, 'Invalid subscription ids');
      const payload = payloadBody(body.notification, config.origin);
      const recipients = await transaction(store, now, (state, window) => {
        rate(state, window, 'send-global', 200, body.ids.length);
        return body.ids.map(id => ({ id, record: state.subscriptions[id] }));
      });
      const results = [];
      // Sequential delivery bounds sockets and makes the worst-case network time explicit.
      for (const { id, record } of recipients) {
        if (!record) { results.push({ id, status: 'not_found' }); continue; }
        let agent; let deadline;
        try {
          agent = await pinnedAgent(record.subscription.endpoint, deps.resolve);
          const delivery = deps.sendNotification(record.subscription, payload, {
            vapidDetails: { subject: env.PUSH_VAPID_SUBJECT, publicKey: env.PUSH_VAPID_PUBLIC_KEY, privateKey: env.PUSH_VAPID_PRIVATE_KEY },
            TTL: 3600, urgency: 'normal', timeout: 5000, agent,
          });
          await Promise.race([delivery, new Promise((_, reject) => {
            deadline = setTimeout(() => { agent.destroy(); reject(new Error('Delivery deadline')); }, 7000);
          })]);
          results.push({ id, status: 'accepted' });
        } catch (error) {
          if (error.statusCode === 404 || error.statusCode === 410) {
            await transaction(store, now, state => {
              if (state.subscriptions[id]?.revision === record.revision) delete state.subscriptions[id];
            });
            results.push({ id, status: 'expired' });
          } else results.push({ id, status: 'failed' });
        } finally { clearTimeout(deadline); agent?.destroy(); }
      }
      return response(200, { results });
    } catch (error) {
      // Never return/log raw SDK errors: they can contain endpoint tokens and credentials.
      return response(error instanceof HttpError ? error.status : 503, { error: error instanceof HttpError ? error.message : 'Notification service unavailable' });
    }
  };
}
