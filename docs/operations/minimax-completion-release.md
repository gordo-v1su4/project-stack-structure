# MiniMax completion release and live acceptance

This is an application-only release to the existing public app and Project Stack Structure production Trigger project. The deployment owner executes the commands after checks pass and the exact release commit is pushed. It does not update Dockhand, Compose, shared services, or GPU models. Private platform recovery remains governed by the current proxmox-home runbook.

## BWS convergence

Use the existing process-private BWS bootstrap; never print token values, secret files, or CLI JSON records. From the reviewed application checkout:

```powershell
bun run trigger:env:sync -- -DryRun
bun run trigger:deploy:env
bun run trigger:env:sync
```

The deploy sync writes only the manifest's `triggerDeployment` pointers to `/home/gordo/.config/project-stack-structure/trigger-deploy.env` with mode `600`. Runtime sync imports `triggerProduction` into this project's `prod` environment. The H3 runtime needs the existing media and SwarmUI settings plus `RUSTFS_ACCESS_KEY`, `RUSTFS_SECRET_KEY`, and `RUSTFS_S3_ENDPOINT` from the reviewed manifest. Verify presence and endpoint reachability without exposing values. SwarmUI must be reachable from the production worker, not just the Windows browser.

For this release, the existing web production S3 variables were already configured. Only those three exact BWS-backed S3 variables were imported into this app's Trigger production environment; unrelated runtime variables and the shared platform were preserved. The protected existing deployment credential file is reused after presence/permissions checks.

Web deployment uses the production Trigger key and reviewed `applicationProduction` mappings. The release owner is using the Bun-invoked Vercel CLI directly; the historical PowerShell Vercel sync script still invokes `npx.cmd` and is not the command for this release. Do not copy `.env.local` wholesale, invoke the historical LAN-app env loader, or change OAuth settings as part of worker deployment.

## Isolated VM100 application build

The canonical remote checkout is preserved. Commit/push the reviewed release first; verify the fetched branch contains that exact SHA. This example creates a separate immutable build checkout and refuses to overwrite an existing directory:

```powershell
$releaseCommit = (git rev-parse HEAD).Trim()
if ($releaseCommit -notmatch '^[0-9a-f]{40}$') { throw 'Expected a full release commit SHA.' }
@'
set -euo pipefail
release_commit="$1"
base=/home/gordo/project-stack-structure
git -C "$base" fetch origin codex/minimax-completion
git -C "$base" merge-base --is-ancestor "$release_commit" FETCH_HEAD
build_dir="/home/gordo/project-stack-structure-build-${release_commit}"
test ! -e "$build_dir"
git -C "$base" worktree add --detach "$build_dir" "$release_commit"
cd "$build_dir"
test "$(git rev-parse HEAD)" = "$release_commit"
export PATH="/home/gordo/.bun/bin:$PATH"
bun run trigger:deploy -- --dry-run
bun run trigger:deploy
'@ | ssh gordo@192.168.8.222 bash -s -- "$releaseCommit"
if ($LASTEXITCODE -ne 0) { throw 'VM100 application deployment failed.' }
```

Do not run the example against an uncommitted checkout: deployment is intentionally pinned to a pushed commit. Record the release SHA, emitted deployment code/version, image digest and successful registry push. Query the production worker's 17-task inventory. H3 uses the existing `local-ai-generation` ID, so the new version/source and a real H3 run are required evidence beyond that inventory. Deploy the web app from the same reviewed commit and record its immutable deployment URL and production alias.

## First real render: smallest complete slice

1. Open the existing public app with a real authenticated browser session. Load the saved existing Love Me Tonight film and make a named finishing copy. Preserve its confirmed story, analyzed master, captions, named references, and useful source placements.
2. Reuse suitable captioned source footage before rendering. Choose one substantive unresolved song window and one intentional shot; ignore numerical 20ms/tail slivers as independent generation requests. Bind only the named characters actually present plus the intended environment references. Compile and lint the actual prompt against duration/FPS before submission.
3. Dispatch through the app's `/api/generate/h3` route. Correlate current project/plan/window, job/run IDs, newly deployed worker version, actual reference versions, native workflow and provider prompt ID. Repeat the same intent/read status without launching duplicate inference.
4. Read the durable video bytes and inspect actual codec, dimensions, FPS, duration and frame count (`nb_frames` or `nb_read_frames` when available). Watch the clip for identity, wardrobe, action, camera motion and continuity. A provider success response or clean prompt lint alone is insufficient.
5. Reload and reopen the saved project; verify the selected candidate remains pending in the same draft window. Prepare/play its musical context, approve the exact reviewed draft snapshot, and verify the saved selection and timeline agree. A changed candidate/trim must not retain stale approval.

This slice does not require a new story treatment, vocal stem/SRT, manual Seedance/Nano Banana production, Qwen still experiments, a new task ID, a database migration, a local OAuth loop, or a local Trigger worker. It preserves all existing useful work while proving the actual missing-footage boundary.

## Remaining end-to-end gates

- Pass code checks/build, then prove the same web/worker release live; local tests do not deploy either half.
- Exercise a recoverable failure/resume and reload while a job is active. Confirm correlation survives and no second logical asset/inference appears. Test stale-reference/plan rejection without discarding accepted footage.
- Exercise master-only/zero-footage planning and generation/review without caption or lyric prerequisites, independently of completing the existing film first.
- Use the finish plan's ten fixed story beats; review available source ranges, generate genuine remaining coverage in bounded batches, and revise defective windows without restarting accepted work.
- Review the full-song dynamic cut. Final approval must cover the current exact candidate/trim snapshot; no underlength candidate, repeated-frame loop, silent black filler or unapproved replacement may hide a gap.
- Export through the production worker to durable storage. Save final object/project/export lineage, download/read full bytes, probe master-song duration/order, and watch the actual playable full-song MP4 for musical alignment, pacing, story, identity and continuity.

The implementation, first render, full-song assembly, and creative acceptance are distinct completion gates. Record concrete evidence for each in the workflow checklist; do not mark the film done after tests, deployment, one clip, or an unreviewed technical export.
