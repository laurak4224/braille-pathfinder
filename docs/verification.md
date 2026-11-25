# Local verification

Verified on Linux, Node 22.23.2, Playwright Chromium (headless). No remote push or deployment was performed. Three bounded OpenClaw worker sessions owned PWA assets, notification backend, and accessibility source respectively; coordinator integrated generated files, dependencies, browser UI and tests. One PWA worker returned a failure status after writing assets; coordinator inspected and tested those assets rather than treating worker status as proof.

## Reproducible commands

- `npm run build`: generates index.html and dist.
- `npm test`: 22 passing tests, zero failures. Includes backend validation, ownership, persistent CAS/quota mocks, SSRF/DNS guard, bounded requests, expiry/stale cleanup, exact installed runtime imports, manifest PNG sizes and JS syntax.
- `npm run test:browser`: actual service worker installation/control, keyboard skip-link and results focus, California plan generation, checkbox persistence across reload, date calculation, light and dark axe scans (zero WCAG-rule violations), 320px largest-app-text reflow, offline reload and uncached-route fallback, API exclusion from cache, no page errors in guide flow. Additional mocked push browser test verifies no automatic registration, explicit opt-in, stable random ownership token, explicit renewal and server/local removal contract. It does not contact real push providers.
- `npm audit --omit=dev`: zero known production dependency vulnerabilities at verification time.
- `git diff --check`: no whitespace errors.

Accessibility worker additionally reported 28 source-only Chromium assertions for validation, clipboard focus, malformed/blocked local storage, leap-day dates, accessible references and reduced motion. The integrated automated suite is the evidence maintained in this repository; do not confuse worker assertions with manual assistive-technology testing.

## Not verified

No live Netlify deployment, Netlify Blobs API/concurrent CAS integration, platform headers, production context.ip, live VAPID delivery, OS install UI, real iOS/Android behavior, screen reader/braille display or full WCAG 2.2 AA certification. Funding contact/legal data has not been independently audited. See README and notifications/accessibility documents for setup and limits. General updates only: no scheduler or personal deadline push system.
