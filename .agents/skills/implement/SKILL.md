---
name: implement
description: "Implement a piece of work based on a spec or set of tickets."
disable-model-invocation: true
---

Implement the work described by the user in the spec or tickets.

For tracked batches, use `ticket-execution`: one primary ticket per implementation context; claim/read back live state, verify its criteria, commit and conclude in the tracker before advancing. Reuse the existing worktree sequentially. Necessary coupled work needs a recorded reason and stopping condition. Run the boundary checker before advancing. User authorization and repo PR/release policy override generic defaults.

If the user passes a ticket reference, fetch it from the issue tracker and state its title before starting. If the reference is ambiguous, ask.

Call the Skill tool with "tdd" where possible, at pre-agreed seams.

Run typechecking regularly, single test files regularly, and the full test suite once at the end.

Once done, call the Skill tool with "code-review" to review the work.

Commit your work to the current branch.
