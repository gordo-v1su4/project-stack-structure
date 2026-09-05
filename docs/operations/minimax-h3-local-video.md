# Local MiniMax H3 video generation

> **Still-conditioning authority:** choose and accept source images with
> [Canonical Higgsfield / Nano Banana reference-continuity protocol](../protocols/higgsfield-nano-banana-reference-continuity.md).
> A first/last pair is conditioning material, not a requirement that either
> endpoint appear in the finished edit; audition and cut the strongest interval.

This runbook covers the verified local MiniMax H3 paths used by Stack Structure:

- **Ref2VA** for a new shot or extension that must preserve people, wardrobe, and location from reference media.
- **FL2VA** for a bridge whose exact first and last frames are already known.
- **SwarmUI** at `http://127.0.0.1:7861` as the stable frontend and API boundary.
- **Standalone ComfyUI** at `http://127.0.0.1:8188` for manual canvas development and debugging only.

The verified Tailscale address for remote/cloud access is `http://100.73.126.36:7861`. On September 1, 2026, both `GetNewSession` and `/ComfyBackendDirect/system_stats` succeeded through that address. Keep the standalone `:8188` backend private and manual-only; remote clients must use SwarmUI.

No application route, Trigger task, test harness, or remote worker may call standalone `:8188` or a Swarm-managed Comfy port directly. A Swarm-managed backend port can change after a restart. All programmatic Comfy API traffic must use `SWARMUI_URL` on `:7861` plus SwarmUI's `/ComfyBackendDirect/*` proxy.

## Verified September 1, 2026

The Love Me Tonight bar-trio pilot passed on both local runtimes with the same prompt, seed, models, and boundary images.

| Runtime | ComfyUI | PyTorch | Execution time | Result |
| --- | --- | --- | ---: | --- |
| Standalone `:8188` | 0.34.0 | 2.11.0+cu130 | 183.323 s | 124-frame H264 MP4, automated and visual gates passed |
| Swarm-managed through `:7861/ComfyBackendDirect` | 0.33.0 | 2.13.0+cu132 | 200.779 s | 124-frame H264 MP4, automated and visual gates passed |

The two independently encoded outputs had full-video SSIM `0.982512`. Both preserved the three-person formation, forward movement, bar geometry, and final-frame target without a late endpoint snap.

Verified FL2VA model stack:

- `minimax_h3_fl2va_pruned_int8_convrot.safetensors`
- `qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors`
- `minimax_h3_video_vae_fp16.safetensors`
- `minimax_h3_audio_vae_fp32.safetensors`
- `res_multistep`, `simple`, 20 steps, seed `424242`
- 1344x768, 124 frames, 24 fps (5.166667 seconds)

Observed peak use was about 26.5 GB VRAM. Host RAM briefly reached about 102 GB during the standalone run. Keep this task on the heavy GPU queue and unload another Comfy process's model cache before moving the job between runtimes.

## Compatibility fix

`ComfyUI-MiniMax-H3-Extend` monkey-patches MiniMax H3 packing to add continuation context. Its older ordinary-keyframe branch rejected native FL2VA last-frame anchors on current ComfyUI with:

```text
ValueError: only first/last keyframe anchors are supported
```

The installed fix keeps the extension's `kind=context` and `kind=context_audio` handling, but delegates ordinary image/audio keyframes to the same positional logic as stock ComfyUI:

- `cond_t = target_origin + FRAME_RESCALE * resolved_frame_index`
- preserve every video latent time row with `_video_grid(...)`
- preserve ordinary audio keyframes with `_audio_grid(...)`

The fix is installed in both local copies:

- `D:\ComfyUI-Easy-Install_v3122\ComfyUI-Easy-Install\ComfyUI\custom_nodes\ComfyUI-MiniMax-H3-Extend\patch.py`
- `D:\ComfyUI_V89\ComfyUI\custom_nodes\ComfyUI-MiniMax-H3-Extend\patch.py`

Restart the affected Comfy runtime after changing this file. Startup must include:

```text
[ComfyUI-MiniMax-H3-Extend] Patched PackedLayout + MiniMaxH3.extra_conds
```

An extension update may overwrite the local compatibility fix. Re-run the FL2VA boundary pilot after any update to ComfyUI or this node pack.

## Build a portable FL2VA workflow

The builder repairs stale embedded-subgraph UUIDs, binds a first and last frame, applies the verified model stack, and deploys the same workflow and images to any supplied runtime roots.

```powershell
bun run scripts/build-minimax-h3-fl2va-workflow.ts `
  --source "D:\user\default\workflows\822-GORDO-VIDEO-GEN-MiniMax_H3-KAI-FL-INT8-20STEP.json" `
  --first "F:\__comfyui-workflows-master\Benji\references\love-me-tonight-bar-trio-1344x768.png" `
  --last "F:\__comfyui-workflows-master\Benji\references\love-me-tonight-bar-trio-ref2va-endframe-0123.png" `
  --prompt ".tmp\e2e-validation\love-me-tonight-ref2va-pilot-20260901\fl2va-boundary-prompt.txt" `
  --output "F:\__comfyui-workflows-master\Benji\Minimaxh3-FL2V-love-me-tonight-boundary-test.json" `
  --runtime-root "D:\" `
  --runtime-root "D:\ComfyUI_V89\ComfyUI" `
  --prefix "h3/love-me-tonight-fl2va-boundary" `
  --duration 5.17 `
  --seed 424242
```

The canonical first frame was the only new still needed for the original gap. The FL2VA last frame was extracted from frame 123 of the accepted Ref2VA base clip; no Grok/Juanito or Nano Banana image was generated for this pilot.

## Run through SwarmUI

SwarmUI owns and may renumber its Comfy backend. Application and automation code must use:

```text
http://127.0.0.1:7861/ComfyBackendDirect/system_stats
http://127.0.0.1:7861/ComfyBackendDirect/object_info
http://127.0.0.1:7861/ComfyBackendDirect/prompt
http://127.0.0.1:7861/ComfyBackendDirect/history/{prompt_id}
http://127.0.0.1:7861/ComfyBackendDirect/view
```

The app's Swarm path already transports durable `initImage`, `videoEndImage`, and `promptImages` references from RustFS and hydrates them only inside the Trigger task. Never expose local drive paths or data URLs in the browser request.

For Comfy prompt submission through SwarmUI, send API-format prompt JSON, not editable canvas JSON. A successful manual canvas run records that API prompt under `/history/{prompt_id}`; it can be used as the stable integration template after replacing only declared prompt, seed, image, and filename-prefix inputs.

## Acceptance benchmark

Run this after every model, node-pack, ComfyUI, Torch, or workflow change:

```powershell
bun run scripts/benchmark-minimax-h3-video.ts `
  --video "D:\ComfyUI_V89\ComfyUI\output\h3\love-me-tonight-fl2va-boundary-swarm_00001_.mp4" `
  --first "F:\__comfyui-workflows-master\Benji\references\love-me-tonight-bar-trio-1344x768.png" `
  --last "F:\__comfyui-workflows-master\Benji\references\love-me-tonight-bar-trio-ref2va-endframe-0123.png" `
  --audit-dir ".tmp\e2e-validation\love-me-tonight-ref2va-pilot-20260901\benchmark-swarm"
```

Automated gates:

- H264, 1344x768, 24 fps, 124 frames.
- first-frame SSIM at least `0.70`.
- last-frame SSIM at least `0.80`.
- final consecutive-frame luma difference is no larger than the clip's 95th percentile (no endpoint snap).

The automated gate is necessary but not sufficient. Visually inspect the full trajectory and fail/requeue for any of these:

- wrong identity or wardrobe drift;
- person-count change or duplicate subject;
- wrong-way movement, side swapping, or reversed staging;
- broken environment geometry;
- freezes, teleports, cuts, or a last-frame snap;
- prompt/action failure.

## Seedance-class comparison

"Comparable to Seedance" means passing a shared production gate, not claiming model parity without a same-input Seedance render. ByteDance's official Seedance 2.0 material emphasizes multimodal reference control, motion stability, instruction following, reference consistency, audiovisual synergy, and stable extension/editing:

- https://seed.bytedance.com/en/seedance2_0
- https://seed.bytedance.com/blog/seedance-2-0-official-launch

Use the same first/last images, duration, action, camera direction, and negative constraints for an approved paid control. Score both outputs on:

1. boundary fidelity;
2. identity and person-count consistency;
3. screen direction and staging;
4. environment geometry;
5. motion smoothness and physical plausibility;
6. prompt/instruction adherence;
7. audiovisual coherence;
8. render time, VRAM, and cost.

Until that paid control is generated and reviewed, describe this package as **Seedance-ready** or **Seedance-class gated**, not as proven Seedance parity.

## Routing recommendation

- Use **local H3 FL2VA** for 5.17-second deterministic bridges with known boundaries.
- Use **local H3 Ref2VA** for a new shot or extension driven by a canonical cast/location reference.
- Use **Seedance 2.0** when a shot needs multiple heterogeneous references, complex choreography, multi-shot editing, or a production control comparison.
- Require action-time approval before a paid Seedance generation.
