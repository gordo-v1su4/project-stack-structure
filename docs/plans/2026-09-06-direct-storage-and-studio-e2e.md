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
the nine specific items are saved in [the UI todo](2026-09-06-studio-ui-todo.md).
Use existing design tokens; preserve musical alignment and
explicit approval of timeline changes. Record service blockers separately from
passing code checks. Paid generation is outside this verification's needs.
