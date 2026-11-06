import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createWorkerJavaScriptManifest, verifyPackagedWorkerJavaScript, WORKER_JAVASCRIPT_MANIFEST } from "../../scripts/verify-trigger-worker-javascript";

const folders: string[] = [], controller = "tmp/cli/managed-run-controller.mjs";
const controllerSource = "export const controller = true;\n";
const controllerHash = createHash("sha256").update(controllerSource).digest("hex");
afterEach(async () => { await Promise.all(folders.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture(source = "import './absent.mjs'; export const untouched = '\\u0000';\n") {
  const root = await mkdtemp(path.join(tmpdir(), "worker-syntax-")); folders.push(root);
  await mkdir(path.join(root, "tmp/cli"), { recursive: true });
  await writeFile(path.join(root, controller), controllerSource);
  await writeFile(path.join(root, "worker.mjs"), source);
  await writeFile(path.join(root, "chunk-OALTO72G.mjs"), "export const P = 1;\n");
  return { root, manifest: await createWorkerJavaScriptManifest(root) };
}
describe("packaged Trigger worker JavaScript guard", () => {
  test("actual Node checks all root entries/chunks and exact controller without evaluating or resolving imports", async () => {
    const marker = "must-not-execute.txt", { root, manifest } = await fixture(`import './absent.mjs'; import {writeFileSync} from 'node:fs'; writeFileSync('${marker}','DO_NOT_RUN');\n`);
    const result = await verifyPackagedWorkerJavaScript(root, controller, manifest, controllerHash);
    expect(result.checkedFiles).toEqual(["chunk-OALTO72G.mjs", "worker.mjs", controller]);
    expect(existsSync(path.join(root, marker))).toBe(false);
  });
  test("literal NUL corruption is rejected even inside an otherwise valid quoted string", async () => {
    const { root, manifest } = await fixture();
    await writeFile(path.join(root, "chunk-OALTO72G.mjs"), Buffer.from('export const P = "\0";\n'));
    await expect(verifyPackagedWorkerJavaScript(root, controller, manifest, controllerHash)).rejects.toThrow("literal NUL: chunk-OALTO72G.mjs");
    await expect(createWorkerJavaScriptManifest(root)).rejects.toThrow("literal NUL");
  });
  test("valid-JavaScript ASCII corruption fails the clean build SHA manifest", async () => {
    const { root, manifest } = await fixture();
    await writeFile(path.join(root, "chunk-OALTO72G.mjs"), "export const p = 1;\n");
    await expect(verifyPackagedWorkerJavaScript(root, controller, manifest, controllerHash)).rejects.toThrow("differs from the clean build: chunk-OALTO72G.mjs");
  });
  test("other syntax errors fail actual Node without exposing source text", async () => {
    const { root, manifest } = await fixture("export const PRIVATE_SOURCE_SENTINEL = ;\n");
    try { await verifyPackagedWorkerJavaScript(root, controller, manifest, controllerHash); throw new Error("Expected failure"); }
    catch (error) { expect((error as Error).message).toBe("Packaged worker JavaScript syntax check failed: worker.mjs"); }
  });
  test("controller is syntax-checked as well as separately hash-bound", async () => {
    const { root, manifest } = await fixture(), invalid = "export const PRIVATE_CONTROLLER_SENTINEL = ;\n";
    await writeFile(path.join(root, controller), invalid);
    await expect(verifyPackagedWorkerJavaScript(root, controller, manifest, controllerHash)).rejects.toThrow("controller patch checksum differs");
    await expect(verifyPackagedWorkerJavaScript(root, controller, manifest, createHash("sha256").update(invalid).digest("hex"))).rejects.toThrow("syntax check failed: managed-run-controller.mjs");
  });
  test("no root bundles, changed chunk sets and nonregular MJS paths fail closed", async () => {
    const { root, manifest } = await fixture();
    await writeFile(path.join(root, "unexpected.mjs"), "export {};\n");
    await expect(verifyPackagedWorkerJavaScript(root, controller, manifest, controllerHash)).rejects.toThrow("file set differs");
    await rm(path.join(root, "unexpected.mjs")); await rm(path.join(root, "worker.mjs")); await rm(path.join(root, "chunk-OALTO72G.mjs"));
    await expect(createWorkerJavaScriptManifest(root)).rejects.toThrow("nonempty root bundle");
    await mkdir(path.join(root, "directory.mjs"));
    await expect(createWorkerJavaScriptManifest(root)).rejects.toThrow("noncanonical file");
  });
  test("escaping, absolute and noncanonical controller names are rejected", async () => {
    const { root, manifest } = await fixture();
    for (const value of ["../managed-run-controller.mjs", "/tmp/managed-run-controller.mjs", "tmp/../managed-run-controller.mjs", "tmp//managed-run-controller.mjs", "tmp\\managed-run-controller.mjs", "tmp/not-controller.mjs"]) {
      await expect(verifyPackagedWorkerJavaScript(root, value, manifest, controllerHash)).rejects.toThrow("controller path is invalid");
    }
    await expect(createWorkerJavaScriptManifest(path.join(root, ".."))).rejects.toThrow();
  });
  test("manifest duplicates or mismatches cannot replace exact clean file authority", async () => {
    const { root, manifest } = await fixture();
    await expect(verifyPackagedWorkerJavaScript(root, controller, { ...manifest, files: [...manifest.files, manifest.files[0]] }, controllerHash)).rejects.toThrow("duplicate files");
    await expect(verifyPackagedWorkerJavaScript(root, controller, { version: 1, files: [] }, controllerHash)).rejects.toThrow("manifest is invalid");
  });
  test("CLI cannot override the pinned controller hash and suppresses raw failures", async () => {
    const { root, manifest } = await fixture(); await writeFile(path.join(root, WORKER_JAVASCRIPT_MANIFEST), JSON.stringify(manifest));
    const script = path.resolve("scripts/verify-trigger-worker-javascript.ts");
    const run = spawnSync(process.execPath, [script, "--root", root, "--controller", controller], { encoding: "utf8", timeout: 30_000, windowsHide: true });
    expect(run.status).toBe(1); expect(run.stderr.trim()).toBe("Packaged worker JavaScript controller patch checksum differs: managed-run-controller.mjs");
    expect(run.stdout).toBe("");
    const override = spawnSync(process.execPath, [script, "--root", root, "--controller", controller, "--expected-hash", controllerHash], { encoding: "utf8", timeout: 30_000, windowsHide: true });
    expect(override.status).toBe(1); expect(override.stderr.trim()).toBe("Packaged worker JavaScript arguments are invalid.");
  });
});
