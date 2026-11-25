import { getStore } from '@netlify/blobs';
import { sendNotification } from 'web-push';
import { Resolver } from 'node:dns/promises';
import { createHandler } from './core.mjs';

// Explicit resolver deadline; never use user-supplied resolvers or environment proxies.
async function resolve(hostname) {
  const resolver = new Resolver({ timeout: 1500, tries: 1 });
  const timer = setTimeout(() => resolver.cancel(), 2000);
  try {
    // IPv4-only delivery is deliberate: avoid IPv6 transition/private routing surprises.
    const addresses = await resolver.resolve4(hostname);
    return addresses.map(address => ({ address, family: 4 }));
  } finally { clearTimeout(timer); }
}
export const handlerFor = kind => createHandler(kind, {
  getStore: () => getStore({ name: 'braille-pathfinder-push-v1', consistency: 'strong' }),
  sendNotification,
  resolve,
});
