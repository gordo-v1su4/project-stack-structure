# Direct storage uploads and six-clip Studio verification

The deployed reference uploader sends images through Vercel and fails with 413
for the supplied character sheets. Upload file bytes from the browser directly
to RustFS with signed multipart requests. Vercel authenticates the user, fixes
the bucket and owner-scoped object key, signs upload parts, and validates the
stored parts before completion. No storage credentials enter the browser.

Use 32 MiB parts to stay below the public storage proxy limit, bounded browser
concurrency, short-lived signatures, and explicit failure/retry states. Abort
failed uploads. Keep gateway download URLs and downstream worker contracts.
Audio, footage, reference sheets, and generated clip uploads share this path.
Existing gateway routes remain compatible for workers and saved projects.

Verify authorization, tampered receipts, object ownership, part order and size,
and browser transport with tests. Build and run the required checks, deploy,
then upload the supplied master, vocal stem, reference sheets, and exactly six
selected videos through visible Studio controls. Verify analysis, captions,
story/matching, prepared playback, persistence, and export using those assets.
The current test uses only three reference sheets, supplied on September 6:
Diego, Valentina, and Underground Latin Club. They replace the three canonical
lead/environment PNGs; the previous versions are archived locally. Crowd sheets
are omitted from the current project, and the expandable library UI is retained.
Preserve the saved pre-test workspace and all source files. Improve observed
UI friction only after the technical walkthrough, per the user's later request;
the requested follow-ups are saved in [the UI todo](2026-09-06-studio-ui-todo.md).
Use existing design tokens; preserve musical alignment and
explicit approval of timeline changes. Record service blockers separately from
passing code checks. Paid generation is outside this verification's needs.

## Production walkthrough evidence

- Production `main` through `a476848`: direct RustFS uploads, live activity,
  caption recovery, per-video caption rerun, and viewport-centered source preview.
- Preserved the earlier workspace as `Workspace before E2E · 2026-09-06`.
  Current project is `Love Me Tonight · six-clip E2E · 2026-09-06`.
- Uploaded the master song, vocal stem, three current reference sheets, and
  exactly six fixture videos through visible production controls. All six
  videos are stored; 42 normalized scenes have 42 captions. The vocal stem
  produced 24 timed lyric lines. Save/restore retained this populated project.
- The six initial failed analysis runs came from the previous oversized
  environment sheet. Those remain visible as historical failures. All six
  source cards now show captioned, with no active or queued ingest work.
- Clicked S4's per-video rerun. Four new caption jobs completed (13–14 seconds
  each); S4 returned to 4/4 captioned. Other source cards remained complete.
- Opened S4's source preview while the ingest page was scrolled. The popup is
  centered in the viewport and the source frame loads. Generic native controls
  and the fixed 24 fps readout remain deferred UI work.
- Code checks before deployment: full check passed with 508 tests after caption
  recovery; per-video/portal changes passed typecheck, affected lint, four source
  identity tests, and production build. Existing lint warnings remain.
- Story treatment generation has been started from the populated project with
  a seed grounded in Diego, Valentina, club dancing, and the visible escape
  footage. Story, Split, Match, prepared preview, and export verification remain
  in progress; the walkthrough is not yet complete.
