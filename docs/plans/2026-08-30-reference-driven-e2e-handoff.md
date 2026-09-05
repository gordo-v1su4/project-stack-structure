# Reference-Driven Studio E2E Handoff — 2026-08-30

> **Creative prompting authority:** use
> [Canonical Higgsfield / Nano Banana reference-continuity protocol](../protocols/higgsfield-nano-banana-reference-continuity.md).
> This handoff owns the E2E fixture and execution contract. It does not override
> the current asset-quality, prompt, or still-acceptance rules.

## Goal

Complete a new, evidence-backed Project Stack Structure end-to-end music-video run for “Love Me Tonight” using the existing repository song and source videos plus the newly supplied canonical references: Diego (new male sheet), Valentina (new female sheet), all three background-dancer sheets, and the new Underground Latin Club environment sheet. First inventory and ingest/caption the media and references, then write and confirm a story that fits the actual footage and lyrics, split and semantically match real footage into that story, distinguish true gaps from weak or repetitive matches, generate reference-consistent stills and any necessary continuation/cutaway footage only for selected story holes, audition and approve replacements, complete Join/Effects/Export, and verify the final playable audiovisual output and persisted project in the visible app. Preserve unrelated local changes and never print or store secrets. Stop for action-time confirmation immediately before any paid generation submission.

## Canonical fixture contract

**Current asset-quality status (2026-09-01): not ready for continuity-critical
generation.** The installed `character-1.png` and `character-2.png` are sharp
source material but have no printed canonical names and only one frontal facial
view each. Rebuild and replace them with visibly named, face-led sheets before
the next image/video E2E. Their existing checksums must not bypass this gate.

The Studio E2E accepts only the following active reference filenames under `.local-fixtures/media/reference-sheets/`:

| File | Role | Authority |
|---|---|---|
| `character-1.png` | Diego | Visibly named, sharp, face-led identity and wardrobe authority; replaces every older Diego reference. |
| `character-2.png` | Valentina | Visibly named, sharp, face-led identity and wardrobe authority; replaces every older Valentina reference. |
| `environment.png` | Underground Latin Club | Location, layout, lighting, materials, and palette. |
| `crowd-1.png` | Background dancers | Black-styled underground-club crowd sheet. |
| `crowd-2.png` | Background dancers | Gold/red performance crowd sheet. |
| `crowd-3.png` | Background dancers | Casual underground-club crowd sheet. |

The fixture lane also requires exactly 21 MP4s directly under `.local-fixtures/media/videos-to-test-with/` and these two audio files:

- `.local-fixtures/media/Love me tonight (Remastered x2) Stems (132BPM)/Love me tonight (fullsong).wav`
- `.local-fixtures/media/Love me tonight (Remastered x2) Stems (132BPM)/Love me tonight - stem-only-Lead Vocal.wav`

Older or similarly named reference files are intentionally not fallback candidates. The harness fails before upload when the six canonical sheets or exact video count are missing.

Filename presence and checksum integrity are necessary but not sufficient. Before
generation, visually verify that each lead sheet contains the correct canonical
name, multiple sharp facial angles with readable skin texture, a stable look and
one useful wardrobe view. Full-body views are secondary. Low-resolution video
grabs may guide blocking only and cannot become texture or likeness authorities.

## Desktop pickup

The binary bundle is transferred separately by the Syncthing-backed Hermes Obsidian vault. On Windows it appears at:

```text
C:\Users\Gordo\Documents\Github\hermes-notebook-vault\04-Projects\Project Stack Structure\E2E Handoffs\2026-08-30\transfer-bundle
```

In PowerShell:

```powershell
Set-Location C:\Users\Gordo\Documents\Github\project-stack-structure
git status --short --branch
git fetch origin
git rev-list --left-right --count main...origin/main
git pull --ff-only origin main

& "C:\Users\Gordo\Documents\Github\hermes-notebook-vault\04-Projects\Project Stack Structure\E2E Handoffs\2026-08-30\transfer-bundle\install-on-desktop.ps1"
```

Do not pull over unprotected desktop changes. The installer verifies all 29 files against `manifest.sha256`, archives prior active references/videos, installs the bundle into the ignored fixture tree, and verifies the installed hashes again.

For a new Codex desktop task, use this pickup instruction:

> Read `04-Projects/Project Stack Structure/Session Handoff 2026-08-30.md` in the Hermes Obsidian vault, then continue its active E2E goal in `C:\Users\Gordo\Documents\Github\project-stack-structure` on `main`.

## Execution order

1. Verify the Git revision, fixture hashes, 21-video count, two audio files, and six active references.
2. Start the authenticated app and run the Studio fixture lane through upload, scene detection, captions, Essentia, Deepgram, semantic matching, and persisted draft creation.
3. Open the persisted project in the visible app. Confirm Diego, Valentina, the club, and exactly three crowd assets appear under their correct roles.
4. Review the real scene captions and lyric timing before rewriting the story. The story must explain the observed footage rather than force footage into a prewritten template.
5. Split and match the footage. Classify every weak section as a true hole, a weak match, or acceptable repetition.
6. Prepare reference-consistent still/video prompts only for approved holes or weak matches. Lead references control named identities; crowd sheets control extras only; the environment sheet controls the scene world.
7. Stop and request action-time confirmation immediately before any paid image or video generation submission.
8. After approval, generate and audition replacements, then finish Join, Effects, and Export.

## Acceptance gates

- The persisted project contains the correct master/stem, 21 analyzed video sources, scene captions, story state, semantic matches, and six uploaded reference assets.
- No older Diego, Valentina, crowd, or location image is used.
- Every story section is supported by lyric timing and observed footage, or explicitly marked for generation/repetition.
- Generated shots preserve named-lead identity boundaries, crowd-only identity/wardrobe behavior, and club continuity.
- The final persisted export is playable and has valid video and master-audio streams with duration aligned to the analyzed song.
- Passing checks, successful uploads, or a generated file alone do not replace visible-app playback and persistence verification.

## Non-goals and safety

- Do not expose credentials or copy secret values into Git, Obsidian, reports, or chat.
- Do not submit paid generation automatically.
- Do not stage `.local-fixtures/`, `media-to-test-with/`, transfer-bundle binaries, or unrelated worktree changes in the repository commit.
- Remove the temporary Syncthing media bundle only after the Windows installation passes checksum verification; retain the Obsidian handoff note.
