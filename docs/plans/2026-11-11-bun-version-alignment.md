# Bun version alignment follow-up

User request, November 11, 2026: use one pinned Bun version across local development, web builds, the Trigger worker runtime and release tooling.

Current verified differences: local 1.4.4; web build 1.3.14; Trigger runtime 1.3.3. The web server itself runs Node. The existing worker deployment tooling also has its own pinned Bun executable; inventory and align it during this follow-up.

Qualify one selected version against Linux worker startup, native dependencies, storage/TLS guards, application tests, builds and the public app before release. Keep this separate from approved commit 251517b; do not broaden the in-progress release.

November 11 interview clarification: version alignment should cover the other
applications on the server as well, potentially starting with Trigger and its
related tooling. First priority is clarifying and improving the populated film's
review/editing workflow and media responsiveness. See
[the review-workflow interview](2026-11-11-review-workflow-performance.md).
