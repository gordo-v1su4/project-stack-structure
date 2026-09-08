# Trigger execution contract

Read this before implementing or diagnosing model calls, media processing, task
progress, or result consumption. The entry points are linked from README and
AGENTS.md. Deployment details and the task inventory live in
[Trigger production operations](../operations/trigger-production.md).

## Required production path

```text
Visible app action
  → authenticated Next.js route: validate and dispatch
  → Trigger task: queue, trace stages, invoke authenticated service
  → GPU model / processing service: return its typed result
  → Trigger task: validate required stages and return final output
  → authenticated run lookup: terminal status and output
  → app: validate domain result, present proposal, persist accepted state
```

All production model and heavy processing requests, including verification runs,
must use their Trigger task. Do not put inference in a Next.js request, silently
fall back to direct gateway inference, or treat a direct diagnostic as app
acceptance. Lightweight authentication, validation, storage access, and health
probes are not inference jobs. A direct health probe can establish reachability;
it cannot establish that dispatch, queueing, stage execution, or result delivery
works. If a model diagnostic is needed, distinguish it explicitly from production
verification and reproduce the relevant behavior through Trigger.

Trigger is the orchestrator. Its CPU machine size does not specify the model's
inference device. The authenticated gateway calls the GPU backend; verify GPU
layers/device and activity separately. Shared queue concurrency does not replace
the backend GPU lock. Local video generation must use SwarmUI and its managed
ComfyUI backend, as specified in AGENTS.md.

## Dispatch and ownership

- Authenticate the session before accepting input. The server-only orchestration
  helper also requires a user ID; anonymous dispatch must throw.
- Validate the domain request, configured provider, durable input references, and
  authorization before dispatch. Keep service credentials server-side.
- Attach exactly one `user:<githubOwnerId>` tag. Run retrieval verifies this tag;
  realtime tokens are short-lived and scoped to the same user.
- Give repeated transport submissions of one intent a stable idempotency key.
  Include user identity, material payload fields, and the relevant contract
  version. A changed request or corrected validation attempt must not reuse a
  cached failed result accidentally.
- Return a queued acknowledgment promptly. It is not a completed result.

Story uses `POST /api/story/treatments` for both generation and revision. The
optional `x-story-request-id` header must be a UUID. Its HTTP 202 response is:

```json
{
  "success": true,
  "queued": true,
  "orchestration": "trigger.dev",
  "runId": "run_...",
  "model": "configured-model"
}
```

See [the route](../../src/app/api/story/treatments/route.ts) and
[dispatch/idempotency helpers](../../src/lib/triggerOrchestration.ts).

## Progress is separate from the result

Use [work metadata helpers](../../src/trigger/workMetadata.ts) for `stage`,
`stageLabel`, and `providerStatus`, plus honest counts or indeterminate progress.
Use named trace spans for independently meaningful stages. Keep safe run/model
identifiers and fixed diagnostics in logs; do not log complete prompts, footage
payloads, credentials, or private references.

The activity feed is user-scoped observability. It omits payload/output bodies;
it is not the domain result transport. Terminal Trigger status overrides stale
stage metadata: a failed run can still have its last metadata set to `reviewing`.
Do not interpret that as continuing work or a queue entry.

`GET /api/orchestration/runs/[runId]` retrieves the authorized run, including
terminal flags, `output`, `error`, and timestamps. Consumers wait for successful
completion, then parse output. Failed, cancelled, timed-out, malformed, or
unreviewed output must not become an accepted proposal. Preserve the user's
existing edits when a run fails or a stale response arrives.

## Story authoring and review contract

[The Story worker](../../src/trigger/storyTreatment.ts) runs
`qwen-story-treatment` on `vm100-heavy` with these trace spans:

1. `Prepare GPU story model`: health/start/readiness.
2. `Author story on GPU`: POST `/story/treatments/author` with `operation`,
   `model`, `instructions`, `input`, `max_tokens`, and `review_context`.
3. `Review story logline on GPU`: POST `/story/treatments/review` with the
   **exact authored output**, the same operation, and the same review context.

Both gateway routes require bearer authentication. Authoring returns an output
object and may return model/usage information; it cannot grant review approval.
Only the independent review response can supply
`logline_review: {version: 1, status: "passed"}`. Validate that marker inside
the review span before returning the worker result. Never manufacture it to
bypass a rejection, and never trust a marker returned by authoring.

The final successful Trigger output has this shape (camelCase at this boundary):

```json
{
  "ok": true,
  "loglineReview": {"version": 1, "status": "passed"},
  "model": "configured-model",
  "output": {"treatment": {}},
  "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}
}
```

`usage` is optional and currently reports authoring usage, not combined review
usage. The abbreviated `treatment` above must contain the full domain schema;
generation instead returns `output.treatments` with faithful, bold, and wildcard.
The app asserts `loglineReview` and parses the domain object before presenting a
proposal. Completion means the proposal is ready for human review; it does not
confirm the story or insert media into the timeline. See
[server materialization](../../src/lib/storyTreatmentServer.ts),
[the app consumer](../../src/components/studio/StoryTreatmentPlanner.tsx), and
[the reference/writing protocol](higgsfield-nano-banana-reference-continuity.md#visible-writing-and-output-rules).

## Failure, retry, and time limits

- A semantic review rejection raises `AbortTaskRunError` with safe actionable
  feedback. Do not automatically regenerate the identical request inside the
  worker merely because review rejected it.
- The Story app currently allows two validation attempts. A correction becomes
  a new Trigger run with feedback and a different validation-attempt key. This
  is distinct from two attempts within one Trigger run.
- Missing stage endpoints or review approval fail closed. Deploy gateway stage
  endpoints before the worker; do not silently fall back to the combined legacy
  endpoint when stages are unavailable.
- Story currently permits two worker attempts for other errors. A transport
  failure during review can rerun authoring on a worker retry; the stages are
  traced spans, not separately checkpointed child tasks. Do not claim stage
  resume or exactly-once inference. Paid generation requires its own no-duplicate
  spend policy; never copy this retry policy blindly.
- Current limits: task 600 seconds; model readiness up to 300 seconds; author
  request 390 seconds; review request 135 seconds; app polling 540 seconds.
  These are individual ceilings, not an additive guaranteed budget. A cold start
  can exhaust the outer deadline. Diagnose the actual stage and timestamps before
  describing first-attempt failure as a queue or GPU problem.

## Deployment and acceptance evidence

Deploy compatible authenticated service endpoints, publish the Linux Trigger
worker to the production registry, and deploy any changed web request/consumer
code. A web deployment does not publish a Trigger worker. Record source SHA,
worker version, deployment code, image digest, and separate service provenance.

Then verify through the signed-in app:

1. Submit one real action and correlate its run ID in Trigger.
2. Check the worker version, queue wait, stage traces, and actual inference device.
3. Inspect both a successful return and a review rejection when changing review
   handling. A rejection must show its failed stage and leave no accepted proposal.
4. Confirm the app consumes the correct result, preserves existing edits on
   failure, and persists accepted state across reload where applicable.
5. Record what remains unverified. Tests, registry publication, an empty queue,
   and gateway health do not prove the complete user flow.

On 2026-09-08, worker source `1419904` published as `20260908.3`, deployment
`atibuyuz`, image digest
`sha256:50a7e27afe716d2b37ad6b47bcea39e2c711a390e4bfe431b7e1c5088b8167d7`.
Gateway stage changes are in sibling `proxmox-home` commit `ac396f8`; both deployed
stage endpoints rejected unauthenticated requests. Publication and endpoint auth
were verified; live app stage/result acceptance remains pending at this record.

Focused coverage: `tests/unit/storyTreatmentTask.test.ts`,
`tests/unit/storyTreatmentServer.test.ts`, and the gateway's `test_story.py`.
Keep this document synchronized with any changed boundary, retry behavior, or
output schema so the next agent does not reconstruct the contract from logs.
