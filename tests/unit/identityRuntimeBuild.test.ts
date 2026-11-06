import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import type { BuildContext, BuildLayer } from "@trigger.dev/core/v3/build";
import { identityRuntime, identityRuntimeInstructions, IDENTITY_RUNTIME_ENV, IDENTITY_UV_IMAGE } from "../../trigger.identity-runtime";

describe("identity worker build runtime", () => {
  test("deploy packages a pinned offline runtime without changing the dev environment", () => {
    const layers: BuildLayer[] = [];
    const noop = () => {};
    const context = (target: "dev" | "deploy"): BuildContext => ({
      target, addLayer: layer => { layers.push(layer); }, workingDir: process.cwd(),
      config: {} as BuildContext["config"], registerPlugin: noop, resolvePath: async () => undefined,
      logger: { debug: noop, log: noop, warn: noop, progress: noop, spinner: () => ({ stop: noop, message: noop }) },
    });
    const extension = identityRuntime();
    extension.onBuildComplete!(context("dev"), {} as never);
    expect(layers).toHaveLength(0);
    extension.onBuildComplete!(context("deploy"), {} as never);
    expect(layers).toHaveLength(1);
    expect(IDENTITY_UV_IMAGE).toMatch(/^ghcr\.io\/astral-sh\/uv@sha256:[a-f0-9]{64}$/);
    expect(layers[0].deploy?.env).toMatchObject({ IDENTITY_PYTHON_PATH: "/opt/stack-identity/.venv/bin/python", IDENTITY_MODEL_DIR: "/opt/stack-identity/models", UV_OFFLINE: "1", UV_PYTHON_DOWNLOADS: "never" });
  });

  test("base-layer bootstrapping copies its inputs before executing the downloader", async () => {
    const instructions = identityRuntimeInstructions();
    const copy = instructions.findIndex(line => line.startsWith("COPY scripts/identity/"));
    const install = instructions.findIndex(line => line.includes("pip sync"));
    const download = instructions.findIndex(line => line.startsWith("RUN") && line.includes("download_models.py"));
    expect(copy).toBeGreaterThanOrEqual(0);
    expect(install).toBeGreaterThan(copy);
    expect(download).toBeGreaterThan(install);
    expect(instructions[install]).toContain("--require-hashes --only-binary=:all:");
    expect(instructions.join("\n")).not.toContain("/app/scripts/");
    expect(instructions.at(-1)).toBe("ENV UV_OFFLINE=1 UV_PYTHON_DOWNLOADS=never");
    const config = await readFile(new URL("../../trigger.config.ts", import.meta.url), "utf8");
    for (const asset of ["scripts/identity/*.py", "scripts/identity/model-manifest.json", "scripts/identity/requirements.lock", "scripts/identity/licenses/*.txt"]) expect(config).toContain(asset);
    expect(IDENTITY_RUNTIME_ENV.IDENTITY_UV_PATH).toBe("/usr/local/bin/uv");
  });

  test("every resolved Python package is version and hash pinned", async () => {
    const lock = await readFile(new URL("../../scripts/identity/requirements.lock", import.meta.url), "utf8");
    const packages = lock.split(/\r?\n/).filter(line => /^[a-z0-9_-]+==/i.test(line));
    expect(packages.length).toBeGreaterThanOrEqual(10);
    for (const name of ["numpy==2.2.6", "opencv-python-headless==4.12.0.88", "onnxruntime==1.23.2"]) expect(lock).toContain(name);
    const entries = lock.match(/^[a-z0-9_-]+==[^\r\n]+(?:\r?\n[ \t]+[^\r\n]+)*/gim) ?? [];
    expect(entries).toHaveLength(packages.length);
    for (const entry of entries) expect(entry).toMatch(/--hash=sha256:[a-f0-9]{64}/);
    expect(lock).not.toContain("--extra-index-url");
  });
});
