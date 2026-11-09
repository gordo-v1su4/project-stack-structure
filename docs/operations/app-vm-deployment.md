# App VM deployment

Project Stack Structure runs at **https://stack.v1su4.dev** on VM100 App VM.
GitHub-hosted Actions builds exact main commits and activates their pinned images through
the existing Hostinger Dockhand control plane. Next.js remains the framework;
Vercel is not needed for application hosting, authentication callbacks or media
transfers. The migration starts from the previously deployed `05da59e` tree.

## Ownership and scope

| Surface | Owner |
| --- | --- |
| Public ingress | Existing Cloudflare wildcard and VM100 Caddy |
| App | Dockhand Internal stack `project-stack-structure`, container `project-stack-structure-web` |
| Upstream | `127.0.0.1:18102` on App VM; container port 3000 |
| Private runtime values | BWS pointers in `config/secrets.manifest.json`; mode600 `/opt/project-stack-structure/private.env` |
| Deployment settings | Mode600 `/opt/project-stack-structure/deploy.env` |
| Releases | `/home/gordo/project-stack-structure-releases/<full-sha>` |
| Runner | `/home/gordo/actions-runner-stack-structure`; label `stack-structure-production` |
| Durable projects and media | Existing RustFS bucket `stack-structure`, unchanged |
| Background work | Existing Trigger.dev production project and workers, unchanged |

Only the web runtime moves. No library reset, generation, GPU restart, worker
release or storage migration is part of this deployment. GitHub user IDs remain
the owner identities, so the same account reads the existing projects.

The runner service is
`actions.runner.gordo-v1su4-project-stack-structure.stack-structure-app-vm.service`.
Its external job-start hook at
`/home/gordo/stack-structure-deploy-hooks/main-only.sh` rejects other repos/refs.
GitHub environment `production-app-vm` accepts only main. App secrets stay on the
server; they are not copied to GitHub Actions or image build arguments.

## Build and release

`infra/app-vm/Dockerfile` uses Bun for frozen dependency installation and builds
the Next standalone output. The supported webpack build avoids the observed
VM100 Turbopack SIGSEGV. FFmpeg is present only in the hosted build/test stage so
synthetic media tests can run; the app runtime is unprivileged Node 24.
The pinned Debian Trixie base supplies modern FFmpeg for tests; Bookworm's
FFmpeg 5 cannot mux the existing lossless PCM-in-MP4 test fixtures.
`public` and `.next/static` are copied alongside standalone server output.
`.dockerignore` excludes private environments, local media and tool caches.

The hosted build runs `bun run check` in the dependency container and builds the
SHA-tagged image. It transfers a compressed image plus SHA-256 through a short-lived
Actions artifact. `scripts/package-app-vm-image.mjs` preserves the exact image
config and verifies every compressed blob and uncompressed layer digest before
packing a legacy Docker archive with uncompressed layers. VM100's held runtime
failed to unpack the original compressed OCI archive even when its outer
checksum was correct; the normalized archive loads and starts successfully.
This is an import compatibility workaround, not proof that earlier intermittent
transfer corruption or unrelated guest crashes have been repaired.
The deploy job deletes that artifact after use; retention is
one day if a job never reaches cleanup. Images contain no runtime secrets.
`scripts/deploy-app-vm.mjs` checks runtime prerequisites and the transfer checksum,
loads and checks the image revision label, runs its Node binary in an isolated
container to reject falsely successful imports, saves the previous Compose in the
release directory and redeploys via Dockhand.
It verifies exact-image health, public/origin revision equality, anonymous API
denial and managed Compose readback. Activation failure restores the previous
Compose and verifies its image health. No automatic release/image pruning runs.

Builds run away from App VM after native Turbopack and package-install crashes
there. No hypervisor, RAM, Docker engine, or GPU setting was changed for this move.

The literal deployment settings are:

```dotenv
DOCKHAND_URL=http://100.105.199.93:13000
DOCKHAND_ENV_ID=3
```

`infra/app-vm/compose.yaml` is the value-free bootstrap/recovery snapshot.
Dockhand owns the live Compose and its masked runtime settings. Compose
references each setting explicitly; a remote absolute env-file path is resolved
on the management host and does not work for this Hawser deployment. The runner
synchronizes the private App VM values to Dockhand before activation.
Updates to credentials use BWS first; run
`powershell -NoProfile -ExecutionPolicy Bypass -File scripts/sync-app-vm-env.ps1`
from the authorized workstation, then redeploy through Dockhand. The script saves
the previous server environment and prints no values.

### Signed storage connections

Set the optional nonsecret `RUSTFS_S3_ORIGIN_ADDRESS` from private configuration
on the web runtime and Trigger production workers. Keep `RUSTFS_S3_ENDPOINT`
on its configured public HTTPS hostname; server SDK connections resolve only
that hostname to the configured origin IP. HTTPS certificate validation, TLS SNI, signed Host, ETag
conditions and pixel hashes remain required. Presigned browser URLs retain
the public hostname. An unreachable origin fails the request; no public-path
fallback bypasses this setting.

This avoids intermittent `SignatureDoesNotMatch` responses observed through
Cloudflare even with cache status BYPASS. Conditional reads of the same pinned
objects passed through the Caddy HTTPS origin; the precise proxy transformation
is not established. Do not remove `IfMatch` or substitute unconditional reads.

Supply the setting through the private process environment or the sync scripts'
`-StorageOriginAddress` parameter. Normal syncs preserve the existing private
setting when no override is supplied. Keep it in the mode600 App VM environment,
the explicit Dockhand Compose interpolation, and the Trigger production environment. Verify both
deployed runtimes with complete pinned reference reads and conditional source
byte-range reads before resuming content. To roll back routing, clear the
setting on both runtimes and redeploy (pass `-StorageOriginAddress ''` to either
environment sync script); preserve the preceding environment and
Compose snapshots. No Caddy or public DNS change is required.

## Authentication and verification

The existing GitHub OAuth app is **Project Stack Structure Studio** (application
3724592). Its homepage is `https://stack.v1su4.dev` and callback is
`https://stack.v1su4.dev/api/auth/callback/github`. Keep `AUTH_URL` on that HTTPS
origin and `AUTH_TRUST_HOST=true`. Do not rotate its client/session secrets as
part of a hostname change. Interactive browser sign-in is mandatory; minted test
cookies cannot prove OAuth.

Acceptance requires:

- Public `/health` and `http://127.0.0.1:18102/health` report the deployed SHA.
- Anonymous `/api/studio/projects` and storage requests return 401.
- Real browser GitHub sign-in reaches the existing library and project restore.
- A synthetic fixture can upload and play through the new origin; inspect its
  network destination and a ranged response. Do not mutate the real film to test.
- The main-push Actions run deploys successfully through the dedicated runner.
- Existing Beatsmaxxer, Review Room and media gateway smoke checks remain healthy.

The root `/health` is intentionally public and returns only service/revision;
every `/api` route retains its session requirement.

## Rollback

Restore the preceding Compose through Dockhand and redeploy with pull/build
disabled. Retain its image and release cache. Restore `private.env.previous` only
if an environment change caused the regression. Caddy's pre-migration snapshot is
`/opt/caddy-edge/Caddyfile.pre-stack-migration`; validate before a reload and
preserve unrelated routes. Vercel Git deployment is disconnected; restoration
there is a separate deliberate operation, not an automatic fallback.

Canonical ingress/endpoints and Dockhand ownership are also tracked in the
sibling `proxmox-home` repository.
