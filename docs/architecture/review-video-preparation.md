# Prepared video review media

Viewing derivatives reduce transfer and decoding without changing source media,
selected takes, identity evidence, conditioning or export inputs. The current
implementation includes timeline/take hover consumption; public deployment,
proactive ingestion/backfill and populated-film acceptance remain open.

`GET /api/storage/review-video?bucket=...&objectKey=...` authenticates, validates
the configured bucket/safe video object key and verifies source ownership before
reading storage. It pins the current S3 ETag and byte length, then returns
`status: ready` with the stored manifest, or `status: unprepared`. GET never
dispatches work. It does not accept a filesystem path, URL or claimed owner.

`POST` accepts JSON `{bucket, objectKey, intentId}` (4 KiB maximum). `intentId`
must be a UUID. After the same authorization/version checks, a ready result is
reused. Otherwise it dispatches `prepare-review-video` and returns HTTP 202 with
`status: queued`, `orchestration: trigger.dev` and `runId`. That acknowledgment
is not a completed preview. A client reuses its intent for transport retries;
an explicit retry after a terminal failure uses a new intent. Dispatch identity
includes session user, complete source version, recipe and intent. Exactly one
`user:<id>` tag scopes the run and existing authorized run lookup.

The task independently checks the owner binding and authorization, reads its
pinned source with S3 `If-Match`, verifies ETag/length and bounds streamed bytes
before encoding. A source changed during dispatch/download fails without
encoding the replacement. Ready derivatives are reused without downloading or
encoding the source again. Local materialization is temporary worker scratch,
not production media storage; each operation removes its own bounded directory.

The encoder prepares a silent H.264 640×360 proxy, WebP 320×180 poster and
8×4 JPEG scrub sheet of 160×90 cells. It preserves frame cadence and full upright
image, with black padding as necessary. Metadata records the original hash,
dimensions, duration, frame count and source timestamp offset. Scrub times are
nominal sample positions; the original frame cadence is not changed to those
positions. Tagged HDR and unsupported bounds fail explicitly.

Artifacts use the canonical RustFS S3 connection and bucket. Source identity
includes exact owner, bucket, key, ETag, byte length and recipe. Its namespace is
`media-uploads/projects/<owner>/review-video/<identity>/`. Each artifact key
contains its content SHA-256; conditional create prevents a racing encoder from
overwriting a different object's bytes. `ready.json` is created only after all
three artifact writes are acknowledged. A duplicate publisher returns the
existing validated manifest. Failed partial preparation has no ready record.
Manifest parsing checks a 32 KiB streamed bound, recipe/source/metadata and the
exact content-addressed artifact pointers. Preparation failure preserves the
original; consumers must show readiness/failure rather than claim completion.

The task has concurrency one, two attempts and a 900-second limit. Subprocesses,
streaming download and S3 writes also have individual deadlines. No new service,
credential, environment variable, GPU provider, model call or framework is added.
Preparation remains separate from final-cut review and creative approval.

Verification uses synthetic local footage and the actual S3 SDK through a
loopback wire-protocol fixture. It exercises conditional source reads, publish
ordering, ready reuse without another encode, ownership-before-storage, changed
source rejection, scratch cleanup, partial-upload failure, duplicate publication
and manifest pointer tampering. Route/dispatch tests cover auth, input bounds,
read-only GET, ignored forged owner/version fields, safe diagnostics, session
tags and intent/source-version idempotency. These checks do not establish live
RustFS, production worker, populated-film first-frame or hover acceptance.

## Focused hover consumption

Timeline cuts and exact-shot take cards use the shared `ReviewVideoHover`.
It creates no video and makes no preparation request while idle. Pointer dwell
or keyboard focus waits 280 ms before requesting the source's prepared media.
Only same-origin `/api/storage/media` references are eligible. Missing derivatives
dispatch the CPU-only preparation path using a bounded reusable intent map; this
does not regenerate source footage. Observation checks authorized Trigger state
and stored readiness, with failure/cancellation reported without claiming success.

One global coordinator cancels previous observation and immediately pauses,
detaches and unloads its video when the card changes. Leave, focus change,
source/view change, page hide and window blur stop observation/playback. Keyboard
focus can retain the preview after the pointer leaves; a pointer click does not
turn it into a sticky keyboard preview. Any preparation already dispatched may
finish into durable storage after observation stops. It never modifies the cut.

Only the active card mounts a muted video from the prepared proxy. Narrow timeline
cuts open a clamped 320×180 floating preview without resizing the filmstrip;
larger take cards play in place. Floating previews ignore pointer input, keep
the shot label visible, and close on scroll, resize or scope change. Source
trims map through the recorded timestamp offset and clamp to available frames;
the hover loops that viewing window at normal speed. It never falls back to
loading an original video on hover. Unsupported/unavailable sources retain the
explicit original inspection path. A card with no still thumbnail uses a labeled
placeholder until focused preparation is ready; proactive poster delivery is
still part of ingestion/backfill work.

Playback ownership registers this video as passive. Silent browsing cannot pause
the master transport or claim playback in another tab. A master/native playback
claim stops it; it also refuses to start while normal media is playing. Frame
time stays native to the video element; React receives no frame-by-frame state.
Timeline clicks, modifier selection, seek, inspection and explicit Use semantics
remain separate from hover. No timing, selected take or approval changes on hover.
