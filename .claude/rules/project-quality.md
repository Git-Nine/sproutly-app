# Project Quality Rules

## Every feature ships with a test (MANDATORY)
Any new feature — a component, hook, API route, or utility — MUST include at least
one co-located test that exercises its core behavior before the work is considered done.

- Co-locate the test next to the source file: `today-date.test.tsx` next to `today-date.tsx`.
- The test must assert the feature's *observable behavior*, not just that it renders
  (e.g. for a date element, assert the formatted output — not merely "no crash").
- Run `npm test` and confirm it passes before claiming the feature is complete.
- If a feature is genuinely untestable, say so explicitly and explain why — never
  silently skip the test.
