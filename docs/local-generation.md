# Local SwarmUI Generation Gateway

> **Creative prompting authority:** use
> [Canonical Higgsfield / Nano Banana reference-continuity protocol](protocols/higgsfield-nano-banana-reference-continuity.md).
> This file owns local SwarmUI/ComfyUI topology and generation plumbing, not the
> current still-image reference formula.

The Generate tab talks to the desktop **SwarmUI** server through the server-side route at `/api/generate/local`.

SwarmUI is the only app-facing API surface. ComfyUI is the backend engine that Swarm starts/manages; we do not treat ComfyUI as a separate provider from this Mac app.

## Actual desktop topology

Hermes/runbook topology:

- Windows desktop over Tailscale: `desktop-q20uuvd` / `100.73.126.36`
- SSH transport to desktop: `ssh -p 2222 Gordo@desktop-q20uuvd`
- SwarmUI on the desktop: `http://127.0.0.1:7861`
- Swarm-managed Comfy backend on the desktop: `http://127.0.0.1:7821`

From this Mac, the app should use only SwarmUI over Tailscale:

```bash
SWARMUI_URL=http://100.73.126.36:7861
SWARMUI_MODEL=
```

If MagicDNS is healthy, this can also be:

```bash
SWARMUI_URL=http://desktop-q20uuvd:7861
SWARMUI_MODEL=
```

Do **not** configure the app to call `http://100.73.126.36:7821` directly. SwarmUI owns the backend lifecycle and provides the front-end/API gateway.

## SwarmUI API model

Official SwarmUI docs define the app-facing API as JSON `POST` calls to `/API/<route>`. The normal flow is:

1. `POST /API/GetNewSession` with `{}`.
2. Reuse the returned `session_id`.
3. `POST /API/GenerateText2Image` with root-level generation parameters like `images`, `prompt`, `model`, `width`, `height`, `steps`, etc.
4. Fetch returned assets from Swarm paths like `/View/local/raw/...`.

SwarmUI also exposes its Comfy-backed workflow UI inside Swarm. If we need Comfy workflow/json operations later, prefer Swarm's Comfy workflow UI/API rather than making the Mac app depend on the raw Comfy port.

## Local generation presets

The Generate tab defaults to **16:9** output (`1280x720`) instead of the older wide/ultrawide framing. The route also falls back to `1280x720` if a caller does not send dimensions.

The app mirrors the useful Swarm/Hermes image presets as selectable options:

- `SwarmUI default 16:9` — no model override, uses the active Swarm default model.
- `Krea2 Turbo Realism - 260625` — `krea2_turbo_fp8_scaled`, 12 steps, `euler` / `simple`, CFG 1.
- `Z Image Turbo Quality 2` — `Z_Image_Turbo_BF16`, 12 steps, `euler` / `beta`, CFG 1, sigma shift 7, IMAX LoRA weight 1. Recommended trigger words from Civitai: `CINEMATIC FILM STYLE`, `IMAX70MM STYLE`, `FILMSTRIP STYLE`, `65MM FILM STYLE`, `POLAROID`.
- `FLUX 2 Klein Distilled 8 Steps - 260422` — `FLUX-2-Klein-Distilled-9b-Quant-FP8-Scaled`, 8 steps, `seeds_2` / `bong_tangent`, CFG 1.

The Windows-side Hermes preset file is:

```text
D:\SwarmUI_Model_Downloader_v140\hermes_presets.json
```

Do not duplicate the same Krea2 workflow in multiple visible entries; keep one Krea2 preset/workflow target and update that entry when settings change.

## Current Next.js routes

- `GET /api/generate/local` checks the SwarmUI gateway.
- `POST /api/generate/local` sends a SwarmUI generation request.
- `GET /api/generate/local/view?provider=swarmui&path=...` proxies returned Swarm image/video assets.

The browser never needs direct access to the Windows host; the Next.js route proxies status, generation, and output viewing.

## Network checklist

For Mac -> Windows API access, make sure:

1. SwarmUI is actually running on the Windows desktop.
2. SwarmUI is bound to a network-reachable interface. Current detached start uses `--host 0.0.0.0 --port 7861`.
3. Windows firewall allows inbound TCP on `7861` for Tailscale/LAN.
4. The Mac can reach SwarmUI:

```bash
nc -vz 100.73.126.36 7861
curl http://100.73.126.36:7861/
curl -H "Content-Type: application/json" -d "{}" http://100.73.126.36:7861/API/GetNewSession
```

The Comfy backend can still be inspected through Swarm's gateway when needed, for diagnostics only, for example:

```bash
curl http://100.73.126.36:7861/ComfyBackendDirect/system_stats
```

## Hermes references on RackNerd

Relevant runbooks are on `racknerd5`:

- `/root/.hermes/skills/creative/visual-storyline-review-pipeline/SKILL.md`
- `/root/.hermes/skills/creative/visual-storyline-review-pipeline/references/swarmui-harness-patterns.md`
- `/root/.hermes/skills/creative/visual-storyline-review-pipeline/references/swarmui-end-to-end-smoke-review.md`
- `/root/.hermes/skills/creative/visual-storyline-review-pipeline/references/qwen-image-edit-2511-native-comfy-api.md`
- `/root/.hermes/skills/creative/comfyui/SKILL.md`
- `/root/.hermes/skills/creative/comfyui/references/swarmui-api-wrapper.md`
- `/root/.hermes/skills/creative/comfyui/references/swarmui-visual-storyline-image-sequence.md`
- `/root/.hermes/plans/swarmui-comfy-qwenvl3-first-path.md`

## Image grid splitting and RustFS naming

Image grid splitting is reserved for **Higgsfield / Nano Banana** contact-sheet outputs. SwarmUI/Z-Image/Flux/Krea still generations are treated as normal single images and should not show grid-split controls in the Swarm lane.

Generated Nano Banana grids can be split through `splitter.serving.cloud`, but the app-facing flow is **fixed grid only**. Do not use auto gutter detection for the Stack Structure workflow until it is proven reliable.

Supported UI split actions:

- `2x2`
- `3x3`

Flow:

1. Generate a Nano Banana grid through Higgsfield.
2. Browser/app fetches the Higgsfield/Nano Banana grid image.
3. `POST /api/splitter/image` forwards it to `https://splitter.serving.cloud/api/image-split/fixed-grid` with explicit `rows` and `cols`.
4. The route fetches each returned panel.
5. Each panel is uploaded back to RustFS through the existing media gateway.

Durable RustFS folder convention:

```text
media-uploads/image-splits/{source-slug}/{split-id}/
```

Panel filename convention:

```text
{source-slug}__grid-{rows}x{cols}__r{row}c{col}__p{NN}.png
```

Example:

```text
media-uploads/image-splits/krea-hero-grid-00023/split-abc/krea-hero-grid-00023__grid-2x2__r1c1__p01.png
```

Panel UI labels use the same coordinate system:

```text
R1C1 · Panel 01
R1C2 · Panel 02
R2C1 · Panel 03
R2C2 · Panel 04
```

## Higgsfield / Nano Banana Pro generated grids

The app exposes a server-side route at `/api/generate/higgsfield`.

- `GET /api/generate/higgsfield` verifies the active account through the official Higgsfield CLI and the configured `HIGGSFIELD_CREDENTIALS_PATH`.
- `POST /api/generate/higgsfield` queues a Trigger.dev task that uses the official CLI to create a `nano_banana_2` job, waits for completion, downloads the full grid, uploads the full grid to RustFS, runs the fixed image splitter, and uploads split panels to RustFS.
- Browser-only Unlimited Nano Banana Pro and Seedance work follows the separate Chrome operator runbook in [Higgsfield provider routing](architecture/higgsfield-provider-routing.md); it must not replace or overwrite the Gordo CLI identity.

Default generation settings:

- model/job type: `nano_banana_2`
- aspect ratio: `16:9`
- resolution: `2k` unless the UI selects `1k` or `4k`
- split mode: fixed grid, usually `3x3` or `2x2`

Prompt/reference convention:

1. Build and validate the exact attachment manifest from the current UI order.
2. Use a visibly named, high-resolution identity authority and the same canonical
   name in every shot beat.
3. Assign one primary role to each location, identity, crowd or optical reference.
4. Generate continuity-critical frames as standalone 2K images. Treat grids as
   composition boards only.
5. Follow the canonical protocol above for prompt wording and acceptance gates.

RustFS paths:

- Full grid:
  `media-uploads/generated/higgsfield/nano-banana-pro/{character-or-title}/{jobId}/`
- Split panels:
  `media-uploads/image-splits/{source-slug}/{splitId}/`

Studio persistence:

- Browser draft key: `project-stack-structure:studio-project:v1`
- Generated assets are now part of the autosaved draft as `generatedAssets`.
- This is still browser-local persistence, not a multi-user/server project database. If the browser local storage is cleared, the workflow draft disappears even though RustFS assets remain.
