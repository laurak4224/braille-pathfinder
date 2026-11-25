# Braille Display Pathfinder

A single-page web app that helps blind and low-vision people in the United States find out which government program can fund a refreshable braille display, what paperwork each program needs, and the step-by-step workflow with the deadlines the agency must meet.

## What it covers

- All 50 states and the District of Columbia: the state vocational rehabilitation or blind services agency and the state Assistive Technology Act program.
- Funding routes: state VR, the Older Individuals who are Blind program, school districts under IDEA, VA Blind Rehabilitation, iCanConnect for people who are deaf-blind, the free NLS braille eReader loan, and state AT loan libraries.
- A document checklist generated for your situation, saved in your browser.
- Numbered workflow steps per program and a deadline tracker based on 34 CFR 361 (60 days to an eligibility decision, 90 days to an IPE).
- Copyable phone scripts, an eye-doctor request, a school AT evaluation request, and an appeal letter.

## Accessibility

Built screen-reader first: skip link, landmarks, strict heading order, fieldsets and legends, explicit list roles, focus management, polite live regions, 44 px targets, visible focus, text-size control, light and dark themes, and Atkinson Hyperlegible type.

## Files

- `index.html` is the standalone page. Open it directly or serve it with any static host (GitHub Pages works).
- `src/index.html` is the same page without the HTML skeleton, in the form used for publishing as a Claude artifact.
- `build.sh` regenerates `index.html` from `src/index.html`.

## Keep the data current

Agency names, phone numbers and URLs were last reviewed on November 25, 2026. Verify against the [RSA state directory](https://rsa.ed.gov/about/states) and the [AT3 Center](https://at3center.net) before relying on them. Edit the `STATES` array in `src/index.html`, then run `./build.sh`.

This is a guide, not legal advice.
