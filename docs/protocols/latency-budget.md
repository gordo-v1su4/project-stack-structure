# Latency and Correctness Budget

## Purpose
This document defines what “low latency” means for this app.

For this product, low latency does **not** mean every slider change must update instantly.
It means the system must preserve **musical correctness** and **trustworthy playback**.

## Core Principle
An explicit recompute/progress state is better than laggy playback that misses musical accents.

## What is unacceptable
The architecture is unacceptable if:
- clip switches visibly fall behind the music,
- playback misses beat/onset accents,
- the result no longer feels audio-driven,
- background recompute silently degrades the active preview.

## What is acceptable
The system may:
- show a recomputing/progress state,
- rebuild only the affected section,
- take longer locally on macOS during correctness-focused development,
- use heavier remote compute for benchmark or validation work when needed.

## Budget Priorities
1. **Musical correctness**
2. **Prepared playback reliability**
3. **Visual continuity**
4. **Iteration speed**

## Section Recompute Budget
A section change should be evaluated using these questions:
- Was stale work canceled?
- Did the app clearly show recomputing state?
- Did playback resume only when the result was ready?
- Did the resulting join still feel musically correct?

If the answer to the last question is no, the architecture failed even if the system looked fast.

## Playback Correctness Budget
Playback is considered correct only when:
- it uses prepared assets,
- it stays aligned to beats/onsets,
- it does not drift because analysis and playback overlap,
- it preserves the intended continuity mode after the section is ready.

## Benchmark Signals to Capture
Future `bench:latency` work should record:
- section recompute start time,
- section recompute ready time,
- playback restart/swap time,
- whether stale work was canceled,
- continuity mode used,
- hardware lane used (local macOS vs remote machine),
- whether the preview remained musically correct.

## Hardware / Execution Lanes
### Local lane
- macOS local development machine
- acceptable for slower correctness-first testing

### Remote heavy lane
- Tailscale-accessible machine
- Windows + RTX 5090 when high-cost media analysis or benchmarking is needed
- dockerized GPU pass-through where appropriate

These lanes are for testing and benchmarking, not a hard requirement for first-pass development.

## Platform Decision Rule
Stay web-first if the browser path can:
- keep preview musically correct,
- honor explicit recompute boundaries,
- avoid drift under realistic load.

Escalate to desktop/Tauri only if evidence shows those conditions cannot be met.

## Verification Checklist
Before calling the preview path acceptable, verify:
- [ ] music events remain authoritative
- [ ] stale work does not compete with active playback
- [ ] recompute states are explicit
- [ ] motion continuity remains subordinate to musical alignment
- [ ] benchmark notes include hardware lane and observed behavior
