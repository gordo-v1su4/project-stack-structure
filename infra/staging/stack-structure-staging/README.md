# Stack Structure temporary staging stack

This Compose project is the short-lived Windows-5090 bridge. It runs Linux
containers through Docker Desktop's WSL2 backend while native Windows
SwarmUI/ComfyUI owns the 5090 generation provider.

The first child services are:

- `qwen-llama` — standalone `llama.cpp` Qwen3-VL GGUF backend using the
  official [Qwen Hugging Face repository](https://huggingface.co/Qwen/Qwen3-VL-4B-Instruct-GGUF).
  The language model is `Q4_K_M` and the vision projector is quantized `Q8_0`.
  No FP16 model or Ollama runtime is used.
- `caption-gateway` — token-protected FastAPI gateway using the Qwen service
  over the Compose network.
- `media-worker` — optional profile for the existing RustFS video-worker image;
  the temporary Windows profile defaults to CPU-safe FFmpeg (`REQUIRE_GPU=false`,
  `FFMPEG_HWACCEL=none`) so it does not depend on VM100's damaged-RAM host.

Trigger.dev is the durable parent above these services. It owns task queues,
idempotency, retries, and terminal run state. SwarmUI and standalone ComfyUI
are provider APIs outside this Compose project.

The llama.cpp image is pinned to the verified `ggml-org` CUDA 13 server digest
in `.env.example`; do not restore the retired unversioned `ggerganov` alias.

Build the media-worker image from the existing Proxmox Home source checkout
before enabling the profile:

```powershell
docker build -t stack-structure-video-worker:staging `
  C:\Users\Gordo\Documents\Github\proxmox-home\infra\rustfs\video-worker
docker compose --env-file .env --profile media up -d media-worker
```

The worker still polls the shared RustFS video-job queue, but the staging
defaults use CPU decode/encode for compatibility. Set
`MEDIA_WORKER_REQUIRE_GPU=true` and `MEDIA_WORKER_FFMPEG_HWACCEL=cuda` only
after the container's `/health` reports CUDA/NVENC capability.

For deterministic Windows rehearsal, set `MEDIA_WORKER_URL=http://127.0.0.1:18090`
in the Trigger worker environment. The media task then calls the worker's
direct analysis endpoint and does not race a remote RustFS queue consumer.

The same Compose project can move to a Linux GPU host by changing only the
model mount, published bindings, image source, and media/Trigger environment.
Do not put secrets in this directory; inject them from BWS into the runtime
environment.

## Temporary provider endpoints

- SwarmUI: `http://host.docker.internal:7861`
- standalone ComfyUI fallback: `http://host.docker.internal:8188`
- Qwen from the caption container: `http://qwen-llama:18092`
- caption gateway from the Windows host: `http://127.0.0.1:18091`

The standalone Easy-Install ComfyUI launcher currently binds to loopback, so
the direct fallback requires a host-reachable launch mode before a container
can call it. SwarmUI remains the default provider.
