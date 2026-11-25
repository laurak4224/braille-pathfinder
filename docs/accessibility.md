# Accessibility implementation and verification

Reviewed November 25, 2026. Scope: `src/index.html` only, plus this document. The source is an HTML fragment intended to be wrapped with a document language, UTF-8 metadata and a responsive viewport. Funding programs, state data, guide sections and scripts remain intact. This is targeted WCAG 2.2 AA improvement work, **not a conformance certification**.

## Changes

- **Keyboard and predictable interaction (2.1.1, 2.4.3, 3.2.2):** keep the native skip link, controls and disclosures. Changing form options no longer replaces the plan while someone is choosing radio/checkbox options. A status explains that Show my plan applies changes. Explicit submit focuses the results heading; invalid state focuses the state field. Programmatically focused headings/main have visible outlines. The price table's overflow region has an accessible name and a keyboard tab stop.
- **Names and feedback (1.3.1, 2.4.6, 4.1.2, 4.1.3):** checklist boxes have explicit short names and separate explanatory descriptions rather than reading the explanation as part of both. A persistent atomic action status reports copy/reset results without changing button names. New-tab warnings are only appended to links actually targeting a new tab. Text-size limits expose `aria-disabled` but retain focus; click handlers enforce the limits.
- **Validation (3.3.1, 3.3.2, 3.3.3):** state is visibly required, with associated error text and `aria-invalid`. Application date has instructions and an associated error; invalid/calendar-impossible or future dates do not produce deadlines. Clearing the date clears its stored value. Date arithmetic uses local calendar days at noon, including leap days, rather than UTC dates.
- **Storage resilience:** read/write failures and malformed JSON do not stop the planner. A visible polite notice explains possible loss on reload. A session Map retains changes if storage fails. Saved form, checklist, text-size and date values are type/allowlist checked. Saved radio values are compared against existing elements, not interpolated into CSS selectors. Invalid dates are not restored. A denied History API update does not prevent plan rendering.
- **Clipboard:** the fallback checks the actual copy result, removes its temporary field, restores focus without scrolling and reports failure instead of claiming success. The temporary field has an accessible name and is not hidden from the accessibility tree while focused.
- **Reflow, focus and contrast (1.4.3, 1.4.10, 1.4.11, 2.4.7):** stronger light/dark borders; wrapping for long prose/scripts and flexible controls; compact narrow-screen spacing; visible outlines for programmatic focus; forced-colors focus/selection support. No sticky overlay was added. Existing 44px button/summary minimum heights remain.
- **Motion (2.3.3, beyond AA):** smooth scrolling remains limited to no-preference; reduced motion explicitly uses automatic scrolling.
- **No JavaScript:** a noscript notice explains the limitation and links to the federal state-agency directory. The interactive planner still requires JavaScript.

## Verified without running the build

A temporary test harness outside the repository read the current source, wrapped it **in memory** with the basic document skeleton and served it through Playwright routing. It did not generate or edit root `index.html`. Cached Playwright and headless Chromium 1255 were used, with external requests blocked. No packages were installed for these checks.

**28 browser assertions passed:**

1. Initial example renders.
2. Skip link is first tab stop.
3. Skip link focuses main.
4. Missing state exposes error and focuses select.
5. Changing options leaves the old result stable until submit.
6. Submit focuses results heading.
7. Submit updates the selected state.
8. Clear checks clears checklist.
9. January 1, 2026 produces March 2, 2026 for day 60.
10. Future date is rejected.
11. Clearing date persists an empty saved value.
12. Denied clipboard plus false legacy copy result reports failure and restores focus.
13. Successful legacy copy preserves the copy button's name.
14. Same-tab links have no false new-tab announcement.
15. Largest text-size limit exposes disabled state.
16. At 320 CSS px and largest app text size (175% root), no document horizontal overflow.
17. Reduced-motion computed scroll behavior is `auto`.
18. All details expanded still produce no document horizontal overflow at that size.
19. Table overflow region is keyboard reachable.
20. February 29, 2024 produces April 29, 2024 for day 60.
21. Every rendered `aria-labelledby`/`aria-describedby` reference resolves.
22. No normal-flow uncaught browser errors.
23–28. Each of malformed JSON, wrong-type/hostile saved values and blocked localStorage still renders without uncaught errors and retains a checked item when changing states and returning during the same page session.

Additional checks:

- Inline JavaScript parsed with Node `vm.Script` (one inline script, pass).
- `git diff --check` passed for the scoped changes.
- WCAG sRGB contrast calculations: light body text/background 15.68:1; light muted text/white 7.24:1; light accent/soft surface 6.52:1; light border/page background 3.43:1; light focus/white approximately 4.50:1. Dark equivalents: body 16.17:1, muted 8.18:1, accent/soft surface 7.58:1, border/surface 4.50:1, focus/surface 9.03:1. These are selected palette checks, not a complete automated visual audit.

The temporary harness is not a repository deliverable. No build, deploy, secret access, notification controls, PWA edits or commit were performed by this worker. Concurrent coordinator changes elsewhere in the working tree were left alone.

## Coordinator audit follow-up

The coordinator reported axe `label-content-name-mismatch` for the text-size buttons. Replaced visible `A−` / `A+` and overriding aria-labels with plain visible **Smaller text** / **Larger text**. Each button now obtains its accessible name directly from its visible text (WCAG 2.5.3). Source assertions confirmed both labels and absence of overriding aria-labels; the 28 source-only Chromium assertions passed again. The coordinator will rerun `tests/browser.mjs` against its rebuilt integrated output; this worker did not run that runner against stale generated files or regenerate them.

## Remaining manual checks and limitations

- Test **NVDA with Firefox/Chrome, JAWS with Chrome/Edge and VoiceOver with Safari**, plus an actual refreshable braille display. DOM assertions cannot establish speech timing, braille cursor routing, reading order experience or whether repeated polite updates are announced consistently.
- Check copy/reset, checklist progress, deadline errors, storage notices and result-focus announcements with a screen reader. Some readers may announce initial progress/status updates together. Repeat announcements use fresh text nodes but reader behavior still needs testing. Deadline output intentionally contains multiple dates and may be verbose.
- Verify native date entry and its `badInput` behavior across desktop/mobile browsers. Headless Chromium checks do not prove Safari date-picker usability.
- Manually traverse every disclosure, link, checkbox and the scrollable price table using only keyboard; confirm no obscured focus. Automated checks cover key focus transitions, not the entire page's visual focus experience.
- Check real browser zoom at 200% and 400%, OS text scaling, WCAG text-spacing overrides, dark mode, forced-colors/high contrast and mobile landscape. The measured 320 CSS px reflow and app text-size tests are not substitutes for all zoom/platform combinations.
- Native checkbox/radio rendering, external font loading/fallback, disabled appearance and all interaction state colors still need visual review. No axe scan or full WCAG audit was run.
- Check clipboard permission denial in real secure-context browsers and persistence across actual browser restarts/quota exhaustion. Blocked storage was simulated. Session fallback deliberately cannot survive a reload if saving fails.
- Clearing checklist checks only clears the current state's checklist; it is not a global delete of every preference/date. The planner does not save application documents or entered identifying details, only selections, check states, text size and application date.
- PWA, notification UI, deployed wrapper and coordinator-owned additions were outside this worker's scope and need their own integrated accessibility checks.
