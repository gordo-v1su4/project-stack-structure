# Exact remaining-gap targets for external clip imports

The advanced import panel selected a base resolved cut and always assigned the entire cut as the imported candidate's song target. A 2.333-second edited original could therefore be attached to the 6.836-second base cut at 220.874–227.710, although selected P27/P28 already leave only 220.874–223.179 uncovered.

The panel now receives the current draft preview and selected asset IDs. The first uncovered interval inside the chosen resolved cut is the default import target. A dropdown exposes other uncovered intervals; explicit song start/end controls allow a smaller interval inside the same cut. Values remain exact without time rounding. Targets cannot overlap another selected take, including one awaiting identity checks. Missing selected bank entries and invalid targets block import. Existing bank history, original cut/placement metadata, selected IDs, H3 jobs and identity proofs remain unchanged.

The imported file must cover its chosen interval before upload begins. Metadata and upload awaits check the same project, source/plan/current-reference context, selected resolved cut, draft preview, selected IDs, import kind and explicit range. A context epoch rejects changes away and back to the same visible target. A late upload may leave an owned file; it cannot deliver an asset to a changed bank context. The result remains a pending editorial `original-footage-edit` or truthful Seedance asset. Import never selects or approves it.

The synthetic regression uses P26 220.874–223.179 inside the 220.874–227.710 base cut, with P27/P28 already selected. It verifies the exact target, unchanged existing bank/selection, bank-only behavior, and an explicit subsequent P26 selection covering only the remaining gap. Other fixtures cover invalid/overlapping ranges, pending-check reservations, multiple gap intervals, source metadata/upload drift, insufficient duration, and the real panel's rendered exact inputs and missing-bank guard.

This is a web-only change to UI props, a browser helper, tests and this document. It adds no API, worker, policy or generation behavior. Existing Next bundled client/server guidance and the React best-practices skill were applied. Live upload, project save, GPU generation and deployment remain outside this implementation. Root owns browser acceptance and integration checks.

## November 8 completion evidence

The paused work was carried from `codex/exact-gap-import` at `05da59e` into
`codex/exact-gap-completion` based on deployed `3907fbd`. The original two modified
files and three untracked files remain untouched in the paused worktree.

The live R40 snapshot confirms P27 at 223.179–224.769 with source trim 3.267,
and P28 at 224.769–227.710 with trim zero. Unit and interaction fixtures use that
geometry as synthetic editorial data; they do not copy or confer H3 identity proof.

The context guard now includes the actual saved project ID passed by StudioApp,
because separate saved projects may share an internal music-video project ID.
Committed layout effects advance its context epoch; starting an import captures
that epoch. Changing away and back during either await cannot revive stale work.

An actual ReactDOM/HappyDOM StrictMode fixture verifies exact fractional inputs,
overlap blocking, short-file rejection before upload, pending bank-only delivery,
and eight metadata/upload drift cases across target and saved-project changes.
P27/P28 selection and trims stay unchanged. The fixture makes no real network,
owned API or playback calls; it is retained at `.tmp/exact-gap-dom/check.tsx`.
Focused unit tests, typecheck and lint pass. Live RustFS upload, saved-project
readback and selected P26 review remain the film controller's acceptance boundary.
