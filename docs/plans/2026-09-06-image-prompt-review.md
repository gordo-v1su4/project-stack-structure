# Image prompt review

Status: user approved one browser generation on 2026-09-06 using Nano Banana Pro with Unlimited enabled. Added the requested surrounding couples and reddish haze. API credential repair remains separate.

Nano Banana image template only; Seedance prompts are unchanged. Resolution 2K, aspect ratio 16:9, section/placement, billing, and attachment URLs remain job metadata. The four attachments are Diego, Valentina, Underground Latin Club, and the selected source composition, in that order. No crowd sheet.

```text
Image 1 is the character sheet for Diego. Use the exact identity and wardrobe lock.
Image 2 is the character sheet for Valentina. Use the exact identity and wardrobe lock.
Image 3 is the master location reference for Underground Latin Club.
Image 4 guides character blocking and placement in the environment only. Do not copy texture, image quality or facial detail.

Create a new 3x3 cinematic anamorphic grid of shots. Diego and Valentina dance close together in the crowded Underground Latin Club, exchanging an intent look as other couples sway, turn and brush past. Deep reddish smoke hangs between concrete columns, catching amber cage lights above a glistening dance floor. Keep the atmosphere dark, intimate and electric, with red haze, never white smoke. Capture the unfolding moment with dynamic camera movement and varied compositions.
```

134 words. The former panel-by-panel cut list and timing instructions are removed.

## User-supplied results and decision to continue

The user ended prompt experimentation for this walkthrough. Keep the current
application prompt template unchanged. Treat the three supplied images as
manual returned-image fixtures for downstream testing, not as evidence that the
application's generation API succeeded. Do not submit additional generations.
The broader walkthrough still uses six videos and the three canonical reference
sheets; this experiment's extra environment/crowd images do not add a required
crowd-sheet slot.

The user reports that adding two environment/crowd-location images helped the
following prompt succeed. Preserve this example verbatim for later comparison;
it is not an established consistency formula or a replacement default.

```text
use Image 1, for Diego, preserve his exact look, and style and wardrobe lock and image 2 for Valentina use this for her exact look and and wardrobe lock. image 3 is the master location reference for Underground Latin Club.
and image 4, 5 show the crowd and specific location in the environment.

Create a new sequence of shots in a 3x3 cinematic anamorphic grid. use image 1 for Diego and image 2 for Valentina as they dance close together in the crowded Underground Latin Club like image 3, exchanging an intent look as other couples try to out perform, turn and brush past. It should be a little darker and thicker Deep reddish smoke/haze hangs in the aor, catching amber cage lights above a glistening dance floor. Keep the atmosphere dark, intimate and electric. Capture the unfolding moment with dynamic camera movement and varied compositions.
```

Observed reference roles for this reported example:

1. Diego — exact look, style and wardrobe lock.
2. Valentina — exact look and wardrobe lock.
3. Underground Latin Club — master location.
4. Crowd and a specific location within the environment.
5. Crowd and a specific location within the environment.

The exact files used for references 4 and 5 were not identified in this message.
Do not assume they are the earlier source-composition frame or silently reuse
the earlier four-image numbering.

### Preserved returned-image fixtures

Original Downloads files remain intact. Byte-identical copies and a SHA-256
manifest are stored in `.local-fixtures/media/generated-returns/2026-09-06/`.
These local fixtures are intentionally outside Git; the manifest records the
source paths, dimensions and user-supplied provenance.

| Filename | Dimensions | Observed layout |
| --- | --- | --- |
| `hf_20260906_194030_7a811d4a-5a5a-4150-b443-7cb6f5688911.png` | 2752 × 1536 | 2 × 2, four dance compositions |
| `color-graded (1).png` | 2688 × 1520 | 2 × 2, four dance compositions |
| `composite.png` | 2752 × 1536 | 2 × 2, escape/action and close dance compositions |

Provider/model provenance for each individual file is not independently
verified. The user also tried ChatGPT and preferred aspects of its result, but
reported unusual contrast and blotchiness. Preserve the originals for a later
comparison; do not automatically regrade, regenerate or approve timeline use.

### Deferred investigation

- Compare prompt consistency across repeated runs and the named reference
  packets; consider structured JSON prompting as an experiment, not a proven fix.
- Review dark red haze, crowd activity, identity/wardrobe continuity, contrast
  and blotchiness across Nano Banana Pro and ChatGPT outputs.
- Record the user's concern that Higgsfield NSFW failures may hide rate limiting
  as an unverified hypothesis. No evidence in this walkthrough establishes the
  cause of provider refusals or failures.

### Next technical gate

The supplied outputs are 2×2 despite the prompt requesting 3×3. The current
`/api/generate/storyboard/return` route hardcodes a 3×3 split, and the manual-return
UI requires an existing storage URL. Do not feed these images into that path
unchanged: it would produce nine incorrect crops. Continue by supporting an
explicit returned-grid layout and manual file upload, then verify original-image
storage, four panel crops, reload persistence and review before video conditioning.
API submission/return remains unverified; manual import must retain its provenance.


### Selected 3×3 technical-demo return

The user subsequently supplied
`hf_20260906_191631_1151899a-da2e-4378-81e4-42d258e9bbea (1).png`
(2752 × 1536), a true 3×3 grid, and selected it as the easiest technical-demo
input. It is preserved alongside the other three originals and included in the
local checksum manifest. Use this nine-panel grid for the existing return path;
defer 2×2 layout support and retain those examples for later comparison. No
application prompt-template change or new generation is required. Next verify
manual return storage, nine-panel splitting, project persistence and review.

Production import initially failed with splitter `401 access_locked`.
`IMAGE_SPLITTER_ACCESS_CODE` was absent from Vercel Production even though the
server adapter already supports access-gate cookies. The vault value passed a
live access-gate check and was added as a sensitive Production-only variable.
A new deployment and a browser import retry are required to verify the fix.
The selected original was uploaded directly to RustFS with checksum readback;
its storage receipt is in the ignored E2E artifact directory.
