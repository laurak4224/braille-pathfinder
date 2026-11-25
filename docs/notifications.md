# Opt-in Web Push backend

These files implement the server half of notifications. Notifications are **off by default**. This backend change does not deploy anything, schedule sending, or automatically share deadlines. Frontend opt-in/service-worker integration is coordinator-owned; the integrated client uses the registration/removal contract below. A notification accepted by a push provider is not proof that a person received it. This is not a guaranteed deadline-delivery system.

## Runtime and dependencies (coordinator-owned integration)

Use Netlify's modern default-export Functions API on **Node.js >=22.12.0**. Install and lock these exact runtime dependencies in the site's package manifest:

- `@netlify/blobs`: **11.1.11** (strong reads and conditional `setJSON` with `{ modified }` result are required).
- `web-push`: **4.0.0** (ESM named `sendNotification` export).

These versions are pinned in package.json and package-lock.json. The coordinator verified runtime imports and all three real entrypoints using these installed versions. Functions live in `netlify/functions`; shared code and tests are nested below it and are not standalone entrypoints.

Netlify automatically supplies Blobs credentials to modern Functions; `getStore` uses that context and the stable site-wide store `braille-pathfinder-push-v1`, not a deploy-specific store. Do not put personal access tokens, site tokens, or manually supplied Blobs credentials into the browser. Deploy previews must remain disabled unless explicitly configured with separate isolation; the store can otherwise be shared across deploys for a site.

## Environment

Set these through the host's secret/environment controls, scoped to Functions. Never embed them in frontend code, checked-in files, command arguments, or logs.

| Variable | Requirement |
| --- | --- |
| `PUSH_ENABLED` | Exactly `true` to enable; everything else disables. |
| `PUSH_ORIGIN` | One canonical HTTPS origin, e.g. `https://your-site.example`; no path, trailing slash, or credentials. This deployment must serve the frontend at that origin. |
| `PUSH_VAPID_PUBLIC_KEY` | Base64url, unpadded, 65-byte uncompressed P-256 public key. The only key returned by public config. |
| `PUSH_VAPID_PRIVATE_KEY` | Matching 32-byte base64url private key. Secret. |
| `PUSH_VAPID_SUBJECT` | Operator contact `mailto:` or HTTPS URL. Never a credential-bearing URL. |
| `PUSH_SEND_TOKEN` | Random high-entropy server-only bearer token, at least 32 characters. Never ship to frontend. |
| `PUSH_STORAGE_SECRET` | Separate random high-entropy secret, at least 32 characters, for HMAC of ownership tokens and IPs. Never reuse sender token. |

Generate keypairs and tokens with a trusted local/admin workflow and save directly into secret controls. Do not paste secrets into chat. Startup validates the VAPID keypair, origin, and required configuration; partially configured enabled service returns 503. Rotating VAPID keys requires users to resubscribe. Rotating the storage secret invalidates existing ownership tokens and resets IP pseudonyms; plan a controlled registry reset/migration rather than silently rotating it.

## API contract

All responses are JSON except 405; all carry `Cache-Control: no-store`. No CORS headers, cross-origin support, or preflight support are provided. Mutations use POST with `Content-Type: application/json` (optional UTF-8 charset). Compressed request bodies are rejected. Request stream is capped at 16 KiB regardless of Content-Length. There is no cookie/session authentication.

### `GET /.netlify/functions/push-config`

Disabled: `{ "enabled": false }`.

Enabled and fully configured: `{ "enabled": true, "publicKey": "<public VAPID key>" }`.

Read this before offering notification opt-in. Nothing here requests browser permission. This public read accepts requests without Origin, but an explicit foreign Origin or cross-site Fetch Metadata is rejected when enabled.

### `POST /.netlify/functions/push-subscriptions`

Requires `Origin` to match `PUSH_ORIGIN` exactly, including scheme and port. If supplied, `Sec-Fetch-Site` must be `same-origin` or `none`; navigation requests are rejected. The trusted Netlify Functions `context.ip` is mandatory. Client-supplied forwarded-IP headers are ignored.

Register, only after an explicit user action and successful browser `PushManager.subscribe`:

```json
{
  "action": "register",
  "subscription": {
    "endpoint": "<browser-generated push endpoint>",
    "expirationTime": null,
    "keys": { "p256dh": "<browser public key>", "auth": "<browser auth key>" }
  },
  "removalToken": "<client-generated 32 random bytes in unpadded base64url>"
}
```

Success: `{ "id": "<64 lowercase hex characters>", "expiresInDays": 90 }`.

Persist the removal token locally before registration and reuse it for renewal/removal. Use Web Crypto to generate it; it must not be derived from an endpoint, email, or predictable ID. The server only stores its keyed hash. The subscription ID is a SHA-256 of the endpoint and is not an ownership credential. Existing subscriptions cannot be overwritten or removed without their matching token. If a token is lost, unsubscribe locally and obtain a fresh push subscription; there is deliberately no unauthenticated ownership reset. Browser expiration can shorten the nominal 90-day registration retention. Renew registrations explicitly while the user remains opted in.

Remove:

```json
{ "action": "remove", "id": "<subscription id>", "removalToken": "<same local token>" }
```

Success: `{ "removed": true }`. Removal is idempotent for absent IDs. On opt-out the browser must also call `PushSubscription.unsubscribe()` to stop provider delivery even if the server is unavailable. Do not register subscriptions automatically on page load. No identity, disability details, or case documents belong in the registry.

### `POST /.netlify/functions/push-send`

For a trusted server/operator only. Requires `Authorization: Bearer <PUSH_SEND_TOKEN>`. An Origin header is optional for non-browser clients; if present it must match. Frontend must never call this with a secret.

```json
{
  "ids": ["<subscription id>"],
  "notification": {
    "title": "Deadline reminder",
    "body": "Open your local tracker to review your next step.",
    "url": "/#tracker",
    "tag": "deadline-reminder"
  }
}
```

`ids` must contain 1–20 unique lowercase 64-character hex IDs. There is no broadcast, registry enumeration, arbitrary subscription input, arbitrary push headers, or user-selected VAPID credentials. Keep the returned registration ID in the trusted reminder workflow; this backend provides no scheduling or account-to-subscription mapping.

Title/body are required nonblank strings, capped at 100/600 UTF-16 code units. Optional tag is capped at 64. Control characters and extra fields are rejected. Click URL defaults to `/`, must begin with one slash, remain same-origin, and is capped at 512 code units; backslashes, whitespace, and controls are forbidden. Entire serialized payload is capped at 2048 UTF-8 bytes. Avoid private/legal/health data in lock-screen messages. No caller-supplied icon/image/resource URLs are accepted.

Success is a per-ID result:

```json
{ "results": [{ "id": "<id>", "status": "accepted" }] }
```

Statuses: `accepted` (provider accepted, not delivered), `not_found`, `expired` (404/410, registry entry removed), or `failed` (DNS/transport/provider failure). Mixed outcomes still return HTTP 200. Non-2xx provider responses are never followed as redirects. Errors contain no raw provider response, endpoint, or credential. The implementation deliberately does not log subscription data or SDK errors.

General errors: 400 invalid input, 401 sender authorization, 403 origin/ownership, 405 method, 413 size, 415 media type, 429 quota/capacity, 503 disabled/misconfigured/storage unavailable. Rate errors advertise `Retry-After: 3600`. Clients should not blindly retry sends: no idempotency key or exactly-once guarantee exists.

## Safety and persistence

- Only exact HTTPS push hosts `fcm.googleapis.com`, `updates.push.services.mozilla.com`, and `web.push.apple.com` are accepted. Credentials, query, fragment, noncanonical URLs, encoded paths, ports (including explicit default ports), localhost/IP endpoints, and lookalike subdomains are rejected. FCM paths must be `/fcm/send/<token>` or `/wp/<token>`; Mozilla paths must be `/wpush/v2/<token>`. Older/other providers intentionally fail closed; update code and tests after verifying any new provider, never use user-configurable allowlists.
- Delivery independently revalidates stored subscriptions. DNS has a two-second deadline and requires public IPv4 addresses only; any private/mixed answer is rejected. Public answers are pinned into a dedicated HTTPS agent to prevent a second DNS lookup/rebinding; hostname TLS validation stays enabled. Runtime does not use caller-supplied proxies. IPv6-only providers are unsupported. No outbound request to an arbitrary user host is possible through this API.
- A single strong-consistency bounded JSON registry stores up to 500 subscriptions and 258 hourly rate records. Conditional create/ETag compare-and-swap commits registry and quotas together, retrying at most four times. There are no in-memory-only quota fallbacks. Read/write failure, corrupt records, CAS exhaustion, or missing conditional-write support returns 503 and prevents new delivery. Expired subscriptions/rate entries are pruned on successful transactions.
- Fixed UTC epoch-hour quotas: 20 successful browser mutations per trusted IP, 200 successful browser mutations globally, and 200 attempted recipient IDs for sending globally. Quotas are persisted before contacting providers, include missing IDs, and do not refund failures. Races cannot bypass committed quotas. Fixed windows permit bursts around the hour boundary. Shared NAT clients share browser quota.
- Ownership is a bearer capability, not an account login. Browser Origin checks block ordinary cross-site form/fetch attacks, not custom clients forging headers. There is no verification that a registrant controls the first supplied endpoint beyond possession of its valid-looking subscription keys; use a challenge/CAPTCHA/account system for a larger/public deployment.
- Invalid/unauthorized/rejected requests still consume invocation, parsing, cryptographic, and/or storage resources. They are not all durably counted. A motivated attacker can occupy the registry or exhaust global quotas. Configure Netlify edge/WAF rate limits, body/time limits, billing alerts, and platform DDoS protections before public exposure. This bounded small-site design is not a distributed abuse-prevention service.
- Delivery is sequential, max 20 recipients, each DNS at most ~2s and HTTPS deadline 7s (5s socket inactivity timeout); worst-case batch can approach 180s plus storage time. Choose a platform invocation budget accordingly or use smaller batches (1–3 recommended for short timeouts). A platform timeout/crash after quota commit may cause partial delivery; retry can duplicate notifications. Registry and quota storage calls rely on platform/SDK transport timeouts. No automatic retries or detached work continue beyond this invocation.
- 404/410 cleanup uses a revision guard so a concurrently renewed record is not deleted. Successful provider acceptance and registry writes are not a distributed transaction. A failure during stale cleanup can return 503 after earlier recipients were already sent.
- Store values include sensitive endpoint capability URLs, browser encryption keys, pseudonymous ownership hashes, and hourly HMAC IPs. Use restricted Netlify access. TTL is enforced logically, not physical background erasure: an idle registry can retain expired data until another successful transaction. Old blob versions/backups follow provider retention. No end-to-end encrypted at-rest registry or automated export/deletion admin tool is provided.

## Tests and remaining integration proof

From repository root:

```sh
node --test netlify/functions/tests/*.test.mjs
```

Core tests inject a CAS-capable in-memory store, DNS resolver, sender, clock, and test-only ephemeral VAPID keys. They need no credentials, SDK installation, network delivery, browser permission, or real Blobs access. The separate runtime-import regression test intentionally requires the installed runtime dependencies and imports all three real entrypoints without network access or credentials. Coverage includes config, origins, sender auth, strict subscription/endpoint/key validation, SSRF/DNS pinning, streaming size bounds, payload limits, ownership, persistence failures, quotas/CAS races, delivery status, stale removal, and retention.

Mocked unit tests and successful runtime imports are not proof of deployed Blobs semantics or real browser delivery. Before release the coordinator must: lock the tested dependencies; verify Netlify discovery/runtime/context.ip and Blobs conditional writes in a nonproduction site; run two concurrent mutations against real storage; verify the integrated accessible explicit-opt-in frontend/service worker renders only validated fields and focuses/opens same-origin URLs; test opt-out and denied permission; then perform an operator-authorized real push on supported browsers. Service workers should defensively validate received notification data as untrusted. GitHub Pages/static-file hosting alone cannot run these Functions.
