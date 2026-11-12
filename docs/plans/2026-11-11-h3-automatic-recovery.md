# Bounded H3 recovery after transient outages

The original 103-job cohort survived the November 11 desktop restart: 102 videos
were already durable and A103 had timed out before the restart. Persistence and
recovery are separate: H3 dispatch explicitly used one Trigger attempt.

Keep the same owned job, frozen references, request intent, Trigger run and
provider prompt. Enable eight attempts for H3 video dispatch only, with durable
Trigger backoff of 60, 120, 240, then 300 seconds between subsequent attempts.
Only explicitly typed transient preparation/provider reads qualify. Generic
generation, CPU assessments, paid providers, semantic rejection, cancellation,
changed references and uncertain prompt submissions remain single-attempt.

Retrying from the task entry point must read canonical state first: ready jobs
return existing assets, saved prompt IDs resume polling, and uncertain submissions
reconcile rather than POST again. A reconnecting job remains unfinished and
cancellable. Bound pinned-reference downloads so a stalled stream cannot occupy
the worker until its outer 30-minute timeout.

## Acceptance and release

- Exercise provider unavailability before submission, return to service and
  same-job completion with exactly one prompt POST.
- Exercise repeated status failures after submission, then a new worker attempt:
  reuse the original prompt and persist one result without another POST.
- Confirm cancellation, changed ownership/source, ambiguous acknowledgments and
  deterministic failures cannot generate on retry.
- Verify the actual task's retry hook and authenticated dispatch budget; retain
  the existing global GPU queue and idempotency keys.
- Run affected tests, lint, type checking and production build. No extra GPU
  render is required for unit verification.
- Publish the compatible worker before enabling the budget in the web app.
  Existing terminal runs are not automatically replayed by deploying this change.

## Explicit limits

This adds bounded automatic reconnection, not exactly-once GPU execution. Swarm's
native queue/history are memory-backed; a power cut during inference can erase
them. Missing history does not prove that no output was saved. Unknown outcomes
still require reconciliation instead of spending credits on a guessed rerender.
Trigger hard max-duration/system terminal failures are also not ordinary thrown
read errors; this policy does not claim to replay those automatically. A future
provider-side durable submission/receipt service is needed for fully unattended
recreation of interrupted inference after loss of the native queue.
