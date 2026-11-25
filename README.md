# Braille Display Pathfinder

A screen-reader-first guide to US braille display funding. Preserves all 50 states plus DC, program workflows, private on-device checklists, phone/letter templates, and VR deadline calculations. This is guidance, not legal advice; independently verify agency details and program rules.

## Run locally

Requires Node 22 and Python 3 for the browser test server.

```sh
npm ci
npm run build
python3 -m http.server 4178 --bind 127.0.0.1 --directory dist
```

Open `http://localhost:4178`. Use a server rather than opening a file URL. The guide works without notification configuration. Root-domain hosting is required by the manifest, service worker and function paths.

## Files and builds

- `src/index.html`: canonical guide content, styles, and planner behavior.
- `index.html`: generated standalone entry point; regenerate with `npm run build`.
- `app-enhancements.js` and `.css`: install controls and explicit opt-in notification interface.
- `public/`: manifest, PNG icons, service worker, and emergency offline page. Copied into `dist/` at build time.
- `netlify/functions/`: public configuration, subscription lifecycle, and authenticated push sending.
- `netlify.toml`: build, publish directory, Functions and security headers.
- `docs/accessibility.md` and `docs/notifications.md`: audit notes and backend setup/security details.

State, application dates and checklists remain in this browser. General update notifications are optional; these are **not scheduled personal deadline reminders**. Notifications deliberately display generic text on lock screens. Only browser subscription details and an ownership-token hash are stored server-side; no personal plan data is uploaded. Browser storage is not a backup.

## PWA and offline use

On HTTPS (or localhost), visit once and wait for “Your offline guide is ready.” The guide, scripts, icons and manifest are cached. Cached guidance remains usable offline, including locally saved form/checklist data. External agency websites and notifications still require a connection. The bundled Public Sans fonts are cached for offline use. Netlify Function responses are never cached. An install button appears when the browser exposes an install prompt; otherwise use browser Install/Add to Home Screen. iOS push requires a Home Screen web app and supported OS/browser. Automated tests do not prove OS-level installation or delivery.

When releasing shell changes, bump `VERSION` in `public/sw.js`. A waiting worker activates after old controlled tabs close. This intentionally avoids replacing an open guide mid-session.

## Netlify setup (owner action; nothing deployed here)

1. Import this repository into Netlify using `netlify.toml`, Node 22, build `npm run build`, publish `dist`, Functions `netlify/functions`. Use a production HTTPS origin at the domain root. Netlify Blobs must be available in the deployed function environment; use the persistent site-wide store, not deploy-scoped storage.
2. In Netlify’s masked environment-variable settings, configure `PUSH_ENABLED`, `PUSH_ORIGIN`, `PUSH_VAPID_PUBLIC_KEY`, `PUSH_VAPID_PRIVATE_KEY`, `PUSH_VAPID_SUBJECT`, `PUSH_SEND_TOKEN`, and `PUSH_STORAGE_SECRET` as described in `docs/notifications.md`. Generate VAPID/strong random secrets in an owner-controlled secure workflow. Never place private keys or tokens in this repo, browser bundle, command-line arguments, logs, or chat. Only the VAPID public key is returned to browsers.
3. Leave `PUSH_ENABLED` unset/false until configuration and protections are ready. Redeploy after environment changes. Preview domains should remain disabled unless separately configured with their exact origin.
4. Verify opt-in, persistent registration, reload, owner-authenticated removal, and real delivery on each supported browser. Test expiry cleanup and rate limits against deployed Netlify Blobs. Operator sending requires a trusted backend client that reads its bearer token from secure storage; there is deliberately no public administration UI or embedded sender credential.
5. Apply Netlify/platform request controls and monitoring in addition to application quotas. Do not treat browser Origin headers as authentication: non-browser clients can forge them. See the backend document for capacity, retention, sender batch bounds, and provider restrictions.

An ownership capability is generated locally to protect subscription changes/removal. Clearing browser storage can lose this capability; block permission in browser settings immediately if needed, and use the operator retention/deletion process for orphaned records. Records expire after 90 days (pruned on the next successful storage transaction); re-enable after expiry. Server storage is not end-to-end encrypted. Restrict Netlify team/store access and publish an appropriate privacy policy before public launch.

## Tests

```sh
npm ci
npx playwright install chromium
npm run build
npm test
npm run test:browser
```

The browser suite uses Chromium, axe WCAG A/AA rules, real keyboard focus, state/checklist persistence, deadline behavior, light/dark palettes, 320px large-text reflow, and actual service-worker offline reload/navigation. Backend tests use injected storage/network mocks; they do **not** demonstrate live Netlify Blobs or Web Push delivery. Automated checks cannot certify WCAG conformance. Manual NVDA/JAWS/VoiceOver/TalkBack, braille display, high-contrast, zoom and real mobile install/push checks remain necessary.

## Keep funding data current

Agency information was supplied by the original repository. The original page states a November 25, 2026 review date; this implementation does not independently validate all agency contacts or legal claims. Verify against the federal RSA state directory and AT3 Center before relying on details. Edit `src/index.html`, then rebuild.

## Export all website text

After building, run `node scripts/export-all-text.mjs /absolute/path/all-text.md`.
The export includes static and accessibility text, all 51 jurisdictions, all seven
programs and workflows, all 22 checklist items, all 32 form combinations, letter
templates, status/error variants, install metadata, and offline/notification copy.
Identical conditional blocks are included once. Example-state and calculated-date
substitutions are explained. The script checks every state contact field, document
explanation, and program description against the output before writing it.
