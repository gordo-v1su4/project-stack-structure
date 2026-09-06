# ADR-0002: Video frames are composition references, not quality authorities

**Status:** accepted (2026-09-06)  
**Context:** `CONTEXT.md` · `docs/protocols/higgsfield-nano-banana-reference-continuity.md` · grill session 2026-09-06

## Decision

Frames extracted from source clips (scene thumbnails, first/last frame URLs, matched-cut previews) may inform **composition only**:

- **Who stands where** — character placement and blocking (which lead is on which side, pose, screen direction)
- **Where in the room** — localized spatial context within the venue when the broad environment sheet is ambiguous (e.g. by the door vs far wall); same club, specific zone
- **Camera** — angle, framing, beat

They must **never** be treated as authoritative for identity, face, skin texture, sharpness, or wardrobe. The mental model: **paste the character sheet over the blurry grab** — the grab is a layout sketch, not a texture source.

Quality authorities for every generated still or reference-to-video packet:

1. Character sheets (Char 1, Char 2 when applicable) — **who**
2. Environment sheet — **which venue / broad look**
3. Optional crowd / custom sheets per slot rules

The environment sheet holds the broad venue; the composition reference **localizes** action within it so prompts do not conflict across zones of the same location.

Whole-shot replacement **re-creates** the shot from those authorities plus a composition reference — it does not upscale, inpaint, or “continue” the low-res grab.

## Replacement paths

| Path | When | Steps |
| --- | --- | --- |
| **Manual Seedance (current)** | Phase B MVP | App builds packet → operator runs Seedance externally → import clip → approve for Join |
| **Still-first (default product)** | After UI default lands | Cut → composition ref → fresh 2K still → Seedance R2V |
| **R2V direct** | After provider/local validation | Text + sheet refs + timing; skip still |
| **Local Qwen 2511** | Next homelab session | Test order: still with sheets + composition ref → still-first packet → R2V direct |

Local SwarmUI / Qwen Image Edit 2511 tests use the same role split before promoting a UI lane.

## Match stage boundary

Semantic match ranks **video moments** by caption fit, lyrics, motion/color continuity, and duration — **not** by frame resolution or thumbnail sharpness. Low-quality rushes are expected; Generate fixes quality, Match fixes story fit.

## Rationale

Most uploaded rushes are not production-grade stills. Conditioning on grab quality causes identity drift and uncanny upscales. The canonical Nano Banana protocol already separates composition from identity; this ADR applies that rule across Match, Generate, Seedance packets, and local Comfy paths.

## Consequences

- UI copy: retire “source frame / shot anchor” for quality; use **composition reference (from cut)**.
- `buildGenerationReferenceInputs`, `StoryboardPlanner`, and Seedance packets must keep `composition-reference` instructions explicit.
- Provider modes that treat `@Image_1` as exact start frame (`start-frame`) are opt-in and conflict with handle pre-roll — default remains composition-reference.

## Alternatives considered

- **Upscale/inpaint the matched frame** — rejected; preserves garbage texture and wrong identity.
- **Skip sheets when the grab “looks good enough”** — rejected; inconsistent and fails on most rushes.
- **Always R2V, no still step** — deferred; still-first is safer until local R2V reference tests pass.
