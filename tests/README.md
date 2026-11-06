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

## Saved-project H3 verification

`bun run scripts/verify-h3-draft-flow.ts --project-id ID` inspects an authenticated local app and its saved project/H3 jobs without dispatching work. Supply the session through the private `STACK_STRUCTURE_E2E_COOKIE` process environment; the harness never prints or saves cookies. No 21-video fixture bundle is required.

Add `--zero-footage` to prepare a master-only, lyric-free variant locally. Add `--run --limit 1` to save a new `[H3 verification]` project copy, generate at most one planned missing shot through the real H3 route/Trigger path, replay its identical intent, poll its job, read durable media bytes, and verify that the pending candidate survives a saved-project reload. The original project remains unchanged. Each render is real GPU work; `--run` is explicit authorization to execute the chosen bounded lane. `--limit 0` saves a copy without rendering. `--reuse-copy` continues a previously saved verification copy and refuses an ordinary original project.

Reports/checkpoints under `.tmp/h3-verification/` correlate project, plan, run, job, asset, approval counts, remaining approved gaps, and any saved export. This harness never approves candidates or dispatches final export. Playback, identity/continuity review, actual whole-song export, downloaded-artifact inspection, and interactive sign-in remain separate acceptance evidence. Default inspection of `--zero-footage` keeps source-project job observations distinct from the unsaved variant.

On Windows, shell scripts are checked out with LF through `.gitattributes`. Run the test command with Git Bash on PATH and Bun available there; the Windows `system32/bash` WSL shim may not share the workstation's Bun installation. Keep the normal `bun run test` runner so isolated module-mock tests retain separate processes.

## Probe command
Use the local fixture lane to generate a canonical probe manifest:

```bash
bun run probe:media
```

### Six-video story reconstruction lane

Set `STACK_STRUCTURE_E2E_FIXTURE_MODE=studio-six` to select the exact six reviewed
source filenames and SHA-256 values from `tests/fixtures/story-evidence/six-video-review.json`.
This lane loads Character 1, Character 2 and Environment only. It ignores
`STACK_STRUCTURE_E2E_VIDEO_LIMIT`; the other source videos and crowd sheets are not uploaded.
The harness preserves faithful gaps and writes `faithful-plan-with-gaps.json` before
blocking export; it does not repeat sources to manufacture full coverage. For the
interactive story-authoring acceptance use the saved six-clip project, so existing
analysis can be reviewed without dispatching all 42 captions again.
