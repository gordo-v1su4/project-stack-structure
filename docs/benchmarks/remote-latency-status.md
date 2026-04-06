# Remote Latency Status

## Current status
A real remote benchmark comparison now exists, and the remote run was executed from a repo copy under:

```text
C:/Users/Gordo/Documents/Github/project-stack-structure
```

## Local lane
- hardware lane: `local-macos`
- probe duration: `112.98` ms
- preview generation duration: `165.71` ms
- ready-to-play duration: `165.71` ms

## Remote lane
- hardware lane: `local-windows`
- probe duration: `0.05` ms
- preview generation duration: `173.53` ms
- ready-to-play duration: `173.53` ms
- input path: `C:/Users/Gordo/Documents/Github/project-stack-structure/.local-fixtures/media/A_mermaid_discovery_202601202346_ttgv4.mp4`

## Comparison
- probe delta (local - remote): `112.93` ms
- preview delta (local - remote): `-7.82` ms
- ready-to-play delta (local - remote): `-7.82` ms
- faster lane: `local`

## Interpretation
- The repo can now compare local and remote benchmark artifacts successfully.
- Current evidence does **not** force a desktop pivot.
- The local macOS lane was still faster for preview generation on this measured slice.
- Web-first remains acceptable for the current stage of the project.

## Remaining caveats
- This comparison is still based on the initial prepared-preview path, not the final full music-safe preview pipeline.
- The remote benchmark used an explicit input path into the repo copy because fixture-root autodiscovery on the Windows lane still points at the home directory by default.
- The platform decision should still be revisited if richer motion extraction or broader load changes the timing picture.
