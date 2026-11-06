# Managed runner startup-log containment

The actual Trigger CLI 4.5.16 managed controller logs `start.data` when an attempt starts. That payload includes runtime environment variables. Its logger writes properties to stdout before checking `TRIGGER_SEND_RUN_DEBUG_LOGS`; disabling debug forwarding does not prevent the Docker stdout exposure.

This application's `controllerLogContainment()` build extension applies one exact, pinned replacement after the complete application image has been copied. The replacement logs only the run ID and attempt number. The execution payload is unchanged. It does not patch the shared Trigger service or other applications.

The controller version, full original source SHA-256, exact statement count, path containment and patched output SHA-256 are checked. Any SDK/bundler drift fails the build and requires review of the actual new controller; do not remove these checks to make an upgrade build pass. The actual 4.5.16 source was verified offline before implementation. Unit checks cover nested credential sentinels, unchanged execution data and rejected drift.

The config imports only `scripts/trigger-controller-patch-core.ts`, a pure module with no executable entry point, top-level await or `import.meta`. The separate `scripts/patch-trigger-controller.ts` wrapper runs only as an explicit build command. Both files are packaged in the image. A regression using the actual CLI's Node 24.18.0 CommonJS c12/jiti loader reproduced the previous `import.meta` failure and loaded the corrected full config, without authentication or deployment. The same check exercised the extension and confirmed the pinned CLI template copies the application before patching and patches before startup. Direct Bun invocation produced the pinned patched checksum. The required check passes **1,040 tests, 22 skips, zero failures**; the optional installed-CLI loader fixture was separately verified on the real Linux Node toolchain.

For each release, verify that the containment command follows the application copy, verify the built controller checksum, run a bounded CPU task, and inspect **only sanitized startup-log structure**: the attempt properties must contain the metadata allowlist and no `start`/`envVars` object. Do not print raw runner logs or runtime environments.

Production verification on 2026-11-06 passed for commit `a397b329c8adee947adaca39daebde606fd29a3c`:

- Image: `localhost:5000/trigger/proj_wlrcsfnmovzmdwzojzfe:20261106.13.production.vrd6n4kw`.
- Image digest: `sha256:7a8ae1f586b9d1192b0378c91830821b156f1e49d2a1d630f16fc017709c0347`.
- Controller SHA-256: `30e7c4f177113f727cabd3d51a27b5348ce0f9a465dc5ca0723ef55357d338f9`, matching the pinned patched bundle in an isolated, read-only image check.
- Retained BuildKit output in the ignored `.tmp/controller-pure-core-trigger-deploy.log` records the application COPY at line 114, the containment RUN at line 117, and successful patch verification at line 118. The generated Dockerfile was cleaned after the build; a complete retained Dockerfile and its ENTRYPOINT line were not inspected. The final image's entrypoint points to the managed controller verified above.
- First bounded CPU run `run_cmw4wqae302um3foefhgccdou` used this image. Its first 15 seconds contained one started-attempt event, 25 structured log records and zero nonempty runtime-environment objects. Attempt-property names were only `attemptNumber`, `executionId`, `executionRestoreCount`, `runId`, `runnerId`, `snapshotId` and `workerName`; the metadata allowlist check passed. Only names and counts were emitted by the verifier.

The authenticated run lookup reported successful completion. Its recovered preview artifact independently passed full decode and measured 289 frames at 24 fps, lasting 12.041667 seconds. Public artifact download returned 403 because the preview used a global output folder instead of the owner's namespace; that separate ownership-path fix was pending at this verification. CPU artifact success and startup containment do not certify GPU output or shared-infrastructure containment. Ignored metadata-only proofs are retained under `.tmp/security-audit/release-13-*-proof.json`.

The diagnostic's historical failed runner and local ignored evidence are preserved. Credential-consumer inventory and any coordinated rotation are separate work; no credential values belong in this repository, chat, logs or client bundles. Consult the infrastructure-change-capture skill before credential operations.
