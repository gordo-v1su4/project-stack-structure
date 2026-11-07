# Preserve concurrent project edits

The live film save correctly stopped when another browser added crowd sheets. The current project PUT still performs an unconditional whole-object replacement, so an older browser could later erase that addition or a recovered cut. Project updates must use the exact durable revision loaded by that editor.

## Contract

- Return the actual storage ETag as `SavedStudioProject.revision`, outside the persisted JSON body. An authenticated fresh read establishes the editor's base.
- Existing-project PUT requires `If-Match`; absence returns 428 and an obsolete revision returns 409. The storage write itself uses the conditional ETag, closing the read/write race. New project writes use `If-None-Match: *`.
- Preserve authentication, owner-scoped paths, compressed transport, original objects and all unrelated draft fields.
- Keep each browser editor's revision separate. Serialize its saves, advance its base only after its own acknowledged commit, and reject queued work from a project context that has since been restored or switched. Never fetch the newest revision and retry an obsolete snapshot automatically.
- A conflict preserves the browser's unsaved draft and reports that another window changed the saved project. Old deployed clients fail closed until reloaded.
- Update the shared project index with its own conditional merge so concurrent saves cannot drop another project. Do not overwrite a newer summary of the same project.

## Verification

Use deterministic concurrent writers against the storage adapter: exactly one same-base update wins, a losing writer never changes the object/index/local cache, and an old client without a revision cannot replace a record. Cover create collisions, missing objects, owner isolation, conditional-index retries and uncertain acknowledgments. Exercise editor serialization, project switches and conflict handling. Run affected persistence/transport/export tests, lint/type checks, full required checks and build. Before a real film recovery, verify two authenticated browser editors against a separate technical fixture, reload the winner and prove the obsolete editor cannot remove its changes. No live film write occurs while these changes are being prepared.

## Local result

`bun run check` passed with 1,242 passing tests, 23 fixture/environment skips and five preexisting lint warnings; `bun run build` passed. The concurrency lane covers deterministic same-ID creation, exact conditional updates, lost create acknowledgments before an index entry, owner isolation, equal-timestamp delayed index updates, canonical reads during an index outage, and preservation of a newer named-folder successor for unmarked legacy records. Editor tests cover serialized revision advancement, sticky conflicts, unknown acknowledgments, same-project restores and switched-context acknowledgments. These are local mocked/fixture checks; the production browser and durable-storage gates remain pending.
