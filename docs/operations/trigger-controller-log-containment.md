# Managed runner startup-log containment

The actual Trigger CLI 4.5.16 managed controller logs `start.data` when an attempt starts. That payload includes runtime environment variables. Its logger writes properties to stdout before checking `TRIGGER_SEND_RUN_DEBUG_LOGS`; disabling debug forwarding does not prevent the Docker stdout exposure.

This application's `controllerLogContainment()` build extension applies one exact, pinned replacement after the complete application image has been copied. The replacement logs only the run ID and attempt number. The execution payload is unchanged. It does not patch the shared Trigger service or other applications.

The controller version, full original source SHA-256, exact statement count, path containment and patched output SHA-256 are checked. Any SDK/bundler drift fails the build and requires review of the actual new controller; do not remove these checks to make an upgrade build pass. The actual 4.5.16 source was verified offline before implementation. Unit checks cover nested credential sentinels, unchanged execution data and rejected drift.

The patch module must also remain inert when the CLI's CommonJS config loader imports it. Its Bun CLI entry point uses a guarded async function without top-level await. The actual pinned Linux c12/jiti loader reproduced the earlier import error and successfully loaded the corrected full config, without authentication or deployment; direct Bun invocation also produced the pinned patched checksum. The corrected required check passes **1,040 tests, 22 skips, zero failures**; the additional skip is the optional installed-CLI loader fixture, separately verified on the real Linux toolchain.

Before resuming production renders, verify the emitted Dockerfile orders the containment command after the application copy, verify the built controller checksum, run a bounded CPU task, and inspect **only sanitized startup-log structure**: the attempt properties must contain the metadata allowlist and no `start`/`envVars` object. Do not print raw runner logs or runtime environments. The integrated release passes **1,040 tests, 21 fixture skips, zero failures**, and the production build; actual new-image startup verification is still pending.

The diagnostic's historical failed runner and local ignored evidence are preserved. Credential-consumer inventory and any coordinated rotation are separate work; no credential values belong in this repository, chat, logs or client bundles. Consult the infrastructure-change-capture skill before credential operations.
