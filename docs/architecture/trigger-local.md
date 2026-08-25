# Retired local Trigger.dev fallback

The Windows-local Trigger.dev stack was retired after the VM100 production
cutover completed on 2026-07-13. Its old v4.5.2 control plane and ClickHouse
25.8 override are migration history, not a supported recovery path.

`scripts/start-local-trigger.ps1` intentionally fails closed for every action.
Do not restore the old generated environment files, registry authentication,
local project credential, Compose volumes, or pinned source checkout. The
retired generated Trigger environment and exported worker environment were
removed from the workstation on 2026-08-25.

The active control plane is `https://trigger.v1su4.dev`. Production operations,
backup requirements, version pins, ClickHouse checks, credential pointers, and
rollback instructions live in
`proxmox-home/docs/triggerdev-vm100-runbook.md`.

If VM100 ever requires an emergency replacement, treat it as a fresh controlled
deployment: use the currently approved Trigger.dev and ClickHouse releases,
create fresh credentials in BWS, restore only from a reviewed checksummed
backup, align every application SDK/build/hooks/CLI version, and complete a
real production task smoke test before cutover.

Historical local rehearsals proved useful queue limits, idempotency keys,
retry caps, the Qwen model contract, and durable RustFS output. Those
application contracts remain valid; the retired infrastructure and its
credentials do not.
