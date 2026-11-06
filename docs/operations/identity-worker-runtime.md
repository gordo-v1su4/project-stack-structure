# Identity verifier worker runtime

`trigger.identity-runtime.ts` packages the CPU verifier into the existing
Trigger Bun worker. It does not create a service or change SwarmUI, ComfyUI,
Qwen, GPU allocation, or model-container settings.

The build copies uv 0.13.7 from the official Astral image by immutable digest,
installs managed Python 3.12.12, and installs the complete hash-pinned
`scripts/identity/requirements.lock` using uv. Only binary wheels are allowed.
OpenCV headless 4.12.0.88, NumPy 2.2.6 and ONNX Runtime 1.23.2 run on CPU.

The build downloads the two official OpenCV Zoo models described in
`scripts/identity/model-manifest.json`. The downloader checks pinned sizes and
SHA-256 hashes against an immutable repository commit. Weights are downloaded
into the worker image and are not committed to git.

| Worker environment | Packaged value |
| --- | --- |
| `IDENTITY_UV_PATH` | `/usr/local/bin/uv` |
| `IDENTITY_PYTHON_PATH` | `/opt/stack-identity/.venv/bin/python` |
| `IDENTITY_MODEL_DIR` | `/opt/stack-identity/models` |
| `UV_PYTHON_INSTALL_DIR` | `/opt/stack-identity/python` |
| `UV_CACHE_DIR` | `/tmp/stack-identity-uv` |
| `UV_OFFLINE` | `1` |
| `UV_PYTHON_DOWNLOADS` | `never` |

Runtime invocation uses the packaged interpreter and adjacent helper module:

```bash
/usr/local/bin/uv run --offline --no-project \
  --python /opt/stack-identity/.venv/bin/python \
  python /app/scripts/identity/verify.py \
  --input /tmp/job/identity-input.json \
  --output /tmp/job/identity-report.json \
  --model-dir /opt/stack-identity/models
```

Trigger's base-image instructions execute before the normal `/app` copy. The
extension explicitly copies its lockfile, downloader and model manifest to
`/opt/stack-identity/build` before running them. `additionalFiles` separately
ships the Python scripts together at `/app/scripts/identity`, preserving the
verifier's relative import of `download_models`.
The official model license files are shipped alongside the scripts. File globs
exclude local environments and downloaded model caches.

Refresh dependencies with uv, review the resolved pins, then rebuild the worker:

```bash
uv --no-cache pip compile --default-index https://pypi.org/simple \
  --python-version 3.12 --python-platform x86_64-manylinux_2_28 \
  --generate-hashes --only-binary=:all: scripts/identity/requirements.txt \
  --output-file scripts/identity/requirements.lock
```

A separate Linux container smoke on the installed Trigger 4.5.16 Bun/Bookworm
base passed with networking disabled, a read-only filesystem, the non-root Bun
user, two CPUs and 1 GiB RAM. It verified both model hashes, loaded YuNet and
SFace through CPU ONNX Runtime, produced a finite 128-dimensional embedding,
decoded video, and ran the packaged verifier's `--help` entry point. This proves
runtime packaging; identity calibration and creative acceptance require their
own evidence. Worker deployment remains a separate authorized action.

The existing 60-frame pilot fixture also ran in that offline Linux container.
Its scores matched the Windows run within `1.2e-7`, with identical quality
abstentions. Both runs remained unverifiable; numerical parity does not grant
an identity pass.

Upstream guidance: [uv Docker integration](https://docs.astral.sh/uv/guides/integration/docker/)
and [uv-managed Python](https://docs.astral.sh/uv/guides/install-python/).
