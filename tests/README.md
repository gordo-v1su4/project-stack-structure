# Test Structure

## Layout
- `tests/unit/` — pure logic tests
- `tests/integration/` — contract and fixture discovery tests
- `tests/helpers/` — shared helpers and fake data builders
- `tests/fixtures/` — committed lightweight synthetic fixtures or expected outputs

## Local media fixtures
Heavy local media should live outside version control in:

```text
.local-fixtures/media/
```

Tests can also use `TEST_MEDIA_DIR=/absolute/path/to/media`.

## Fixture requirements

The discovery and media integration lane should contain at least:

- one audio file
- one video file

The suite includes real media probing and preview/export generation, so the relevant integration tests need `ffmpeg` and `ffprobe` on PATH. Fixture-dependent tests can skip when media is missing; report those skips rather than treating them as proof of the media path.

## Choosing checks

Use `bun run test <file-or-filter>` for affected tests, for example `bun run test tests/unit/triggerRoutes.test.ts`. The Bash runner isolates tests with conflicting module mocks; running the whole suite directly with `bun test` bypasses that isolation. On Windows, use a Bash environment with Bun available on its PATH.

Run relevant lint/type checks for code changes and `bun run check` before every PR. Documentation-only local edits can be verified with a diff review and checks of links and documented commands. Expand verification when the affected behavior requires it; a passing check does not need repetition without new changes or evidence.

## Full media E2E

`bun run e2e:media` runs [scripts/run-full-media-e2e.ts](../scripts/run-full-media-e2e.ts) against a running app: upload, scene detection, captions, Essentia, Deepgram, matching, preview, and optional final export. It uploads media and dispatches real remote work through the configured services. A localhost URL does not make those dependencies disposable or offline. Use this lane when service integration is part of the authorized task.

Requirements:

1. Run the production app with `bun run build` and `bun run start`, full runtime environment including `TRIGGER_*` and `AUTH_*`, and reachable configured services. The harness defaults to `http://127.0.0.1:3000`; override with `STACK_STRUCTURE_E2E_URL` if needed.
2. Use `.local-fixtures/media/` or set `TEST_MEDIA_DIR`. The default fixture mode is `studio`: the canonical song and vocal stem, exactly 21 videos under `videos-to-test-with/`, and six PNG reference sheets under `reference-sheets/`. Exact filenames are enforced by `resolveFixtureLane()` in the harness; see [the reference-driven handoff](../docs/plans/2026-08-30-reference-driven-e2e-handoff.md) for fixture context.
3. For the synthetic service smoke lane, explicitly set `STACK_STRUCTURE_E2E_FIXTURE_MODE=trigger-smoke`. It requires `trigger-verification-speech.wav` (short speech, under 45 seconds), `trigger-verification-video.mp4`, `trigger-verification-ffglitch.avi`, and `trigger-verification-shader.webm`. Use platform-available speech synthesis and FFmpeg when preparing fixtures.
4. Provide `STACK_STRUCTURE_E2E_COOKIE` in the private process environment. For harness authentication, mint a JWT with `@auth/core/jwt` `encode()`, the server's `AUTH_SECRET`, and salt `authjs.session-token`; set the cookie as `authjs.session-token=<jwe>`. Never print or commit the secret or cookie. Dispatch and polling must use the same identity for Trigger user-tag authorization.

Final export defaults on in `trigger-smoke` mode and off in `studio` mode; set `STACK_STRUCTURE_E2E_INCLUDE_EXPORT=true` when final export is required. Evidence is written under `.tmp/e2e-validation/<runKey>/report.json` with preview and export outputs as produced. Inspect the actual requested output before claiming the pipeline works.

JWT-based E2E bypasses OAuth. After any `AUTH_*` environment change, also verify interactive sign-in by clicking through the production browser flow, as required by [AGENTS.md](../AGENTS.md).

## Probe command
Use the local fixture lane to generate a canonical probe manifest:

```bash
bun run probe:media
```
