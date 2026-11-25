'use strict';

// Root hosting only. Bump VERSION whenever any shell asset changes.
// No skipWaiting: keep an open guide paired with its existing worker/assets.
const VERSION = 'v3';
const CACHE_PREFIX = 'braille-pathfinder-shell-';
const CACHE_NAME = CACHE_PREFIX + VERSION;
const SHELL = '/index.html';
const OFFLINE = '/offline.html';
const ASSETS = [
  SHELL, '/app-enhancements.js', '/app-enhancements.css', OFFLINE,
  '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png',
  '/icons/maskable-512.png'
];
const ASSET_PATHS = new Set(ASSETS);

function isPrivateEndpoint(url) {
  // Decode before checking so encoded API paths never enter Cache Storage.
  let path;
  try { path = decodeURIComponent(url.pathname).toLowerCase(); }
  catch (_) { return true; }
  return path === '/.netlify' || path.startsWith('/.netlify/') ||
    path === '/api' || path.startsWith('/api/');
}

function mayStore(response) {
  return response.status === 200 && response.type === 'basic' &&
    !response.redirected &&
    !/\b(no-store|private)\b/i.test(response.headers.get('Cache-Control') || '') &&
    response.headers.get('Vary') !== '*';
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // Fetch everything first: a missing enhancement must not install a partial shell.
    const responses = await Promise.all(ASSETS.map(async path => {
      const response = await fetch(new Request(path, { cache: 'reload', credentials: 'same-origin' }));
      if (!mayStore(response)) throw new Error('Uncacheable shell asset: ' + path);
      return response;
    }));
    await Promise.all(ASSETS.map((path, index) => cache.put(path, responses[index])));
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
      .map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

async function navigation(request, url) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    // Never turn an API/error response into the saved guide. Query-bearing
    // navigations may be personalized: serve online but do not persist them.
    if (!response.ok) throw new Error('Navigation unavailable');
    if ((url.pathname === '/' || url.pathname === SHELL) && !url.search && mayStore(response) &&
        /\btext\/html\b/i.test(response.headers.get('Content-Type') || '')) {
      await cache.put(SHELL, response.clone());
    }
    return response;
  } catch (_) {
    return (await cache.match(SHELL)) || (await cache.match(OFFLINE)) ||
      new Response('Offline. Reconnect to open Braille Display Pathfinder.', {
        status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' }
      });
  }
}

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  // Explicit bypass, before navigation handling. No cross-origin, API, mutation,
  // authorization-bearing, range, or arbitrary runtime resource caching.
  if (url.origin !== self.location.origin || request.method !== 'GET' ||
      isPrivateEndpoint(url) || request.headers.has('Authorization') ||
      request.headers.has('Range')) return;
  if (request.mode === 'navigate') {
    event.respondWith(navigation(request, url));
  } else if (!url.search && ASSET_PATHS.has(url.pathname)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      // Versioned shell stays coherent until the next worker release.
      return (await cache.match(url.pathname)) || fetch(request);
    })());
  }
});

function safeDestination(value) {
  if (typeof value !== 'string' || value.length > 2048) return self.location.origin + '/';
  try {
    const url = new URL(value, self.location.origin + '/');
    if (url.origin === self.location.origin && !url.username && !url.password &&
        !isPrivateEndpoint(url)) return url.href;
  } catch (_) { /* Untrusted payload: use the guide, never an external URL. */ }
  return self.location.origin + '/';
}

self.addEventListener('push', event => {
  // Payload contract: optional JSON {"url":"/#section"}. Deliberately ignore
  // supplied title/body/actions/tag: lock screens must not reveal guide choices.
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch (_) { /* Generic reminder. */ }
  const url = safeDestination(payload && payload.url);
  event.waitUntil(self.registration.showNotification('Braille Display Pathfinder', {
    body: 'Open the guide when you’re ready.',
    icon: '/icons/icon-192.png',
    tag: 'braille-pathfinder-reminder',
    data: { url },
    renotify: false
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = safeDestination(event.notification.data && event.notification.data.url);
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // Never take over an unrelated same-origin page. Reuse only the guide.
    for (const client of windows) {
      const current = new URL(client.url);
      if (current.origin === self.location.origin &&
          (current.pathname === '/' || current.pathname === SHELL)) {
        try {
          const navigated = await client.navigate(url);
          if (navigated) { await navigated.focus(); return; }
        } catch (_) { /* Fall back to a new guide window. */ }
      }
    }
    await self.clients.openWindow(url);
  })());
});
