# Self-hosted story reuse and metadata privacy release proposal

Status: prepared locally for Robert's approval; no PR, push, merge or activation of this batch. The current public web remains the previously verified `5da6c08`. V1S-436 remains In Progress; the full-song film is unfinished.

## Result and source

The revised story can reuse eligible existing footage within the same saved project. Original requests, media, identity and policy evidence retain their historical authority; new placements bind current per-take evidence and require fresh assembled-cut consent. Changing source/reference inventory remains blocked in this first version. The existing finishing copy `75101b25-fea6-42b1-b2c6-85a9d1deb8eb` is the target, after its verified private R41 checkpoint. No second generic Save As or cross-project grant is needed.

Canonical project metadata also needs protection at the storage and cache boundaries. The observed stack bucket policy permits anonymous reads, and historical Media API JSON uploads used one-year public immutable caching. The prepared correction requires authenticated metadata transport, an anonymous-only origin deny, persistent cache bypass and a bounded historical cache purge. Public media access continues.

Application source is frozen at `13d448c2180e75fce4ea3e602ff915d2ccbbc64f`, tree `402f2494459237b23b635c43b045c2b31f0b3211`, on isolated branch `codex/story-reuse-metadata-privacy`. It includes reuse source `0ad8ad3` as `d965723` and privacy source `33f1947` as `13d448c`. This proposal is a subsequent documentation-only change. Base is current remote main `5da6c08`.

Ops source is `a2bfb8b8e9d415ee6261b456e9af378386537ae7`, tree `45bc9ecc7d3c444ada0da2c383f8040552ed4e00`, on the isolated ops branch `codex/stack-metadata-privacy`, based on verified remote main `e95f298`. The ordinary ops checkout's external documentation changes are preserved separately.

The matching metadata contract is byte-identical LF JSON in both repos, SHA-256 `0e4a2240717d48448f1a45589cec20c0f4158f2993c60580bb56c923d5950b86`. It covers 13 canonical metadata patterns, including legacy drafts, project/index records, jobs, policies, identity evidence, generation scopes/conditioning descriptors and still preparation JSON. Adjacent reference/conditioning/still PNGs and source/generated media remain public. Other buckets are excluded.

## Review and verification completed

- Combined application `bunx bun@1.3.14 run check`: 1,971 passed, 27 fixture-dependent skips, zero failures, 11,150 assertions. Typecheck passes; lint has five existing warnings. Exact production `bunx bun@1.3.14 run build --webpack` passes. No dependencies, task IDs, queues, SDK or provider modes changed.
- The reuse implementation independently passed its Bun 1.4.4 full check and production build. Actual React controls with a synthetic backend passed confirmation/CAS, placement, pending reload, assembled review/acceptance, accepted reload and window-selection clamping. No extra player, real project write or generation occurred. Root visually inspected the fixture screenshot; it does not prove production or creative acceptance.
- Fresh R41 canonical-origin audit: all 29 selected overlays passed canonical job/range/policy/current-reference/applicable first-frame checks and exact current evidence equality. All 84 GETs returned 200; zero writes; project ETag and raw SHA stayed unchanged. This proves origin eligibility, not revised-story fit, new placement consent or video motion.
- Ops: 25 tests / 299 assertions pass, index and both CLI syntax builds pass, diff checks pass. Independent source and final release-plan reviews found no remaining actionable static issue. Boolean CLI switches reject attached/negative values before network access.
- Shared reuse/scope/planning helpers enter the H3 worker bundles. A fresh matching application worker is required before enabling the feature. The existing `20261109.5` worker is not claimed compatible with reuse. Trigger platform/SDK remain pinned; no upgrade.

Local application receipts are in `.tmp/revised-story-privacy-integration-20261109`; individual source/actual-origin receipts are in the `project-story-reuse` worktree's `.tmp/revised-story-reuse`. Ops receipt is `.tmp/privacy-verification-20261109.json` in its isolated worktree. Git-blob and Windows working-file hashes are distinguished in the ops receipt.

## Exact approval scope

Approve preparation/merge of the application and ops PRs and the following coordinated self-hosted activation:

1. Build and verify the matching existing application worker, then deploy the matching web through App VM/Dockhand. No Vercel operation, Trigger upgrade, paid generation or OAuth change.
2. Replace only the Media API source with the reviewed three-file overlay built from the exact currently running immutable image, using `--pull=false --network=none`. Preserve its existing base, dependencies, command, environment and volumes. No normal mutable-base/unlocked dependency rebuild; no RustFS/caption/model service recreation.
3. Apply the exact reviewed anonymous-only metadata deny to the existing `stack-structure` bucket. No other bucket, object move, object-body change or existing object ACL change.
4. In the existing Cloudflare zone, inspect and privately back up the current rules, validate and activate only the reviewed metadata cache-bypass rule, preserving other rules. Purge only four Stack namespace roots: direct-S3 and gateway paths for `media-uploads/projects/` and `media-uploads/studio-drafts/`. This covers historical/deleted/query variants. Public media beneath projects may temporarily have a cold cache; its origin access stays public. No whole-zone/bucket purge.
5. Run bounded authenticated/anonymous/foreign technical acceptance, including a separately named disposable metadata first-write fixture and fresh-process policy readback. Preserve original/finishing/QA project records and the old conflicted browser tab. No film consent or model promotion is included.

## Ordered activation gates

The executable ops sequence is in `hostinger-ops/docs/rustfs-vm-runbook.md`, section “Coordinated release after explicit shared-service approval,” plus its immutable image overlay and cache sections. It governs exact commands, equality guards, private receipts and rollback.

Before service/rule/policy activation, recheck source/runtime/policy drift and complete actual Cloudflare rule/parser/order/normalization/Transform compatibility and access checks. The first post-approval mutation is a harmless never-created-URL purge canary. Its capability receipt must bind a fresh exact inventory; after writer quiescence, refresh the inventory and canary if its hash/deadline changes. Do not treat token verification as purge permission. The current DNS token is active and can read the zone, but rule/normalization reads returned 403; purge/edit permission is unproven. The current in-app Cloudflare tab reached login, so an active browser session is not claimed. Normal account sign-in or a human security prompt may be needed.

Prepare candidate artifacts before the maintenance interval where possible. Stop new application dispatch, naturally drain current writers and maintain the public web write hold. Activate cache bypass and the compatible authenticated gateway before the origin deny. Keep public web stopped through policy and cache purge; use private origin checks before reopening. A first gateway upload can reapply the deny, so the writer hold is required throughout this interval.

Acceptance requires unchanged-original-URL anonymous origin GET/HEAD 403, gateway 401, signed SDK/bearer reads 200 without public Location, owned app reads 200, anonymous/foreign app denial, and no edge refill after a signed read. Recheck public reference PNG/master WAV/source MP4/generated MP4/conditioning PNG HEAD/ranges at 200/206. Verify the exact new worker and self-hosted web image/health, then release the write hold. Cloudflare's [purge documentation](https://developers.cloudflare.com/cache/how-to/purge-cache/) makes clear that a successful API acknowledgement alone does not prove eviction; original URL retests are mandatory.

On failed capability or drift checks, stop before activation. On a later cache purge failure, retain deny/bypass and recover compatible authenticated reads. Rollback uses the saved verified before-image; never rebuild dependencies or automatically restore public metadata exposure. A deliberate full policy rollback that reopens that exposure needs explicit operator acceptance.

## Remaining full-goal work

Release approval does not approve a revised Story/Bible, scene image, model comparison or assembled film. The local managed Swarm qualification has its reviewed CPU frame guard loaded and no inference yet; its private pilot has separate exact submission/recovery/output gates. After technical release, continue the confirmed revised story, full-song scene review, useful-footage placement, missing motion, prepared playback, fresh cut consent and actual full-song MP4 inspection. The earlier five-second export remains technical proof only.
