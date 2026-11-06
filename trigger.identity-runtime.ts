import type { BuildExtension } from "@trigger.dev/core/v3/build";

// Official Astral uv0.13.7 multi-platform image, resolved from GHCR. Pin the
// digest so a mutable tag cannot change the worker's Python bootstrap.
export const IDENTITY_UV_IMAGE = "ghcr.io/astral-sh/uv@sha256:96f40d3904aad8d0bd010539001d36c8e2188b981e1334471a90c4a1d93bb490";
export const IDENTITY_PYTHON_VERSION = "3.12.12";
export const IDENTITY_RUNTIME_ROOT = "/opt/stack-identity";
export const IDENTITY_RUNTIME_ENV = {
  IDENTITY_UV_PATH: "/usr/local/bin/uv",
  IDENTITY_PYTHON_PATH: `${IDENTITY_RUNTIME_ROOT}/.venv/bin/python`,
  IDENTITY_MODEL_DIR: `${IDENTITY_RUNTIME_ROOT}/models`,
  UV_PYTHON_INSTALL_DIR: `${IDENTITY_RUNTIME_ROOT}/python`,
  UV_PYTHON_DOWNLOADS: "never",
  UV_OFFLINE: "1",
  UV_CACHE_DIR: "/tmp/stack-identity-uv",
};

/** Base-image instructions run before /app is copied and before USER bun. */
export function identityRuntimeInstructions(): string[] {
  const root = IDENTITY_RUNTIME_ROOT;
  const python = IDENTITY_RUNTIME_ENV.IDENTITY_PYTHON_PATH;
  return [
    `COPY --from=${IDENTITY_UV_IMAGE} /uv /uvx /usr/local/bin/`,
    "RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates libglib2.0-0 libgomp1 && apt-get clean && rm -rf /var/lib/apt/lists/*",
    `ENV UV_PYTHON_INSTALL_DIR=${root}/python`,
    // additionalFiles places these files in the Docker context. They must be
    // copied explicitly here: the normal /app COPY happens after this layer.
    `COPY scripts/identity/requirements.lock scripts/identity/download_models.py scripts/identity/model-manifest.json ${root}/build/`,
    `RUN uv --no-cache python install ${IDENTITY_PYTHON_VERSION} && uv --no-cache venv --python ${IDENTITY_PYTHON_VERSION} ${root}/.venv && UV_COMPILE_BYTECODE=1 uv --no-cache pip sync --python ${python} --default-index https://pypi.org/simple --require-hashes --only-binary=:all: ${root}/build/requirements.lock`,
    `RUN uv run --offline --no-project --python ${python} python ${root}/build/download_models.py --model-dir ${root}/models && uv run --offline --no-project --python ${python} python -c 'import cv2,numpy,onnxruntime; assert cv2.__version__ == "4.12.0"; assert numpy.__version__ == "2.2.6"; assert onnxruntime.__version__ == "1.23.2"'`,
    // Package setup and model downloads are complete. Runtime calls use only
    // the already-installed interpreter, wheels and verified model files.
    "ENV UV_OFFLINE=1 UV_PYTHON_DOWNLOADS=never",
  ];
}

export function identityRuntime(): BuildExtension {
  return {
    name: "stack-identity-runtime",
    onBuildComplete(context) {
      if (context.target === "dev") return;
      context.addLayer({
        id: "stack-identity-runtime",
        image: { instructions: identityRuntimeInstructions() },
        deploy: { env: IDENTITY_RUNTIME_ENV, override: true },
      });
    },
  };
}
