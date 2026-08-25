[CmdletBinding()]
param(
  [ValidateSet("up", "down", "status", "logs")]
  [string]$Action = "status",
  [switch]$Pull,
  [switch]$ShowMagicLink
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

throw @"
The local Trigger.dev fallback is retired and this launcher is intentionally
fail-closed. Use the production control plane at https://trigger.v1su4.dev and
the VM100 maintenance workflow in proxmox-home/docs/triggerdev-vm100-runbook.md.
An emergency replacement must be built from the currently approved Trigger and
ClickHouse releases with fresh credentials; do not revive the v4.5.2 stack.
"@
