import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFile, mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import type { BuildContext, BuildLayer } from "@trigger.dev/core/v3/build";
import { controllerLogContainment } from "../../trigger.controller-containment";
import { patchTriggerControllerSource, replaceAttemptLogStatement, SAFE_ATTEMPT_LOG,
  TRIGGER_CONTROLLER_SOURCE_SHA256, TRIGGER_CONTROLLER_PATCHED_SHA256, UNSAFE_ATTEMPT_LOG } from "../../scripts/trigger-controller-patch-core";

describe("app-image Trigger controller log containment", () => {
  (process.env.STACK_TRIGGER_CONFIG_LOADER_CLI_ROOT && process.env.STACK_TRIGGER_CONFIG_LOADER_NODE_BINARY ? test : test.skip)("actual Node/CJS pinned 4.5.16 c12/jiti config loader imports only the pure containment core", () => {
    const result = spawnSync(process.env.STACK_TRIGGER_CONFIG_LOADER_NODE_BINARY!, ["tests/helpers/loadTriggerConfig.mjs", process.env.STACK_TRIGGER_CONFIG_LOADER_CLI_ROOT!, process.cwd()],
      { encoding: "utf8", timeout: 30_000 });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('"pinnedCliConfigLoaded":true');
    expect(result.stdout).toContain('"containmentExtensionCount":1');
    expect(result.stdout).not.toContain("attempt logging: metadata allowlist verified");
  });
  test("nested credentials and execution payload never reach the attempt log, while execution receives the original object", () => {
    const source = `const attemptNumber = start.data.run.attemptNumber; ${UNSAFE_ATTEMPT_LOG} return start.data;`;
    const patched = replaceAttemptLogStatement(source);
    const names = ["MEDIA_API_TOKEN", "QWEN_CAPTION_GATEWAY_TOKEN", "FFMPEG_GATEWAY_API_KEY", "DEEPGRAM_API_KEY",
      "RUSTFS_SECRET_KEY", "HIGGSFIELD_CREDENTIALS_JSON", "TRIGGER_SECRET_KEY"];
    const envVars = Object.fromEntries(names.map(name => [name, `SENTINEL_${name}`]));
    const data = { run: { attemptNumber: 2 }, envVars, execution: { payload: { nested: { secret: "SENTINEL_NESTED_PAYLOAD" } } } };
    const logs: unknown[] = [], snapshot = structuredClone(data);
    const result = new Function("start", patched).call({ runFriendlyId: "run_fixture", sendDebugLog: (event: string, properties: unknown) => logs.push({ event, properties }) }, { data });
    expect(result).toBe(data);
    expect(data).toEqual(snapshot);
    expect(logs).toEqual([{ event: "started attempt", properties: { runId: "run_fixture", attemptNumber: 2 } }]);
    expect(JSON.stringify(logs)).not.toContain("SENTINEL");
    expect(JSON.stringify(logs)).not.toContain("envVars");
  });

  test("missing, duplicate, changed and already-patched statements fail closed", () => {
    for (const source of ["", UNSAFE_ATTEMPT_LOG + UNSAFE_ATTEMPT_LOG, UNSAFE_ATTEMPT_LOG.replace("start.data", "start"), SAFE_ATTEMPT_LOG]) {
      expect(() => replaceAttemptLogStatement(source)).toThrow("exactly one");
    }
    expect(() => patchTriggerControllerSource(UNSAFE_ATTEMPT_LOG)).toThrow("differs from the reviewed");
  });

  test("only managed deploys add a post-copy image build command; version and path drift cannot silently deploy", async () => {
    const layers: BuildLayer[] = [], noop = () => {};
    const context = (target: "dev" | "deploy"): BuildContext => ({ target, workingDir: "/repo", addLayer: layer => { layers.push(layer); },
      config: {} as BuildContext["config"], registerPlugin: noop, resolvePath: async () => undefined,
      logger: { debug: noop, log: noop, warn: noop, progress: noop, spinner: () => ({ stop: noop, message: noop }) } });
    const root = await mkdtemp(path.join(tmpdir(), "controller-build-"));
    await mkdir(path.join(root, "tmp/cli"), { recursive: true });
    await writeFile(path.join(root, "worker.mjs"), "export const worker = true;\n");
    const manifest = { cliPackageVersion: "4.5.16", outputPath: root, runControllerEntryPoint: path.join(root, "tmp/cli/managed-run-controller.mjs") };
    const extension = controllerLogContainment();
    try {
    await extension.onBuildComplete!(context("dev"), manifest as never);
    expect(layers).toHaveLength(0);
    await extension.onBuildComplete!(context("deploy"), manifest as never);
    expect(layers).toEqual([{ id: "stack-controller-log-containment", commands: ["bun scripts/patch-trigger-controller.ts --file 'tmp/cli/managed-run-controller.mjs'",
      "bun scripts/verify-trigger-worker-javascript.ts --root /app --controller 'tmp/cli/managed-run-controller.mjs'"] }]);
    expect(layers[0].image).toBe(undefined);
    const clean = JSON.parse(await readFile(path.join(root, "stack-worker-javascript.sha256.json"), "utf8"));
    expect(clean.files.map((file: { file: string }) => file.file)).toEqual(["worker.mjs"]);
    expect(clean.files[0].sha256).toBe(createHash("sha256").update("export const worker = true;\n").digest("hex"));
    for (const bad of [{ ...manifest, cliPackageVersion: "4.8.1" }, { ...manifest, runControllerEntryPoint: undefined },
      { ...manifest, runControllerEntryPoint: path.resolve(root, "../outside/managed-run-controller.mjs") }, { ...manifest, runControllerEntryPoint: path.join(root, "tmp/worker.mjs") }]) {
      await expect(extension.onBuildComplete!(context("deploy"), bad as never)).rejects.toThrow();
    }
    const config = await readFile(new URL("../../trigger.config.ts", import.meta.url), "utf8");
    expect(config).toContain("controllerLogContainment()");
    expect(config).toContain('"scripts/patch-trigger-controller.ts"');
    expect(config).toContain('"scripts/trigger-controller-patch-core.ts"');
    expect(config).toContain('"scripts/verify-trigger-worker-javascript.ts"');
    const extensionSource = await readFile(new URL("../../trigger.controller-containment.ts", import.meta.url), "utf8");
    expect(extensionSource).toContain('"./scripts/trigger-controller-patch-core"');
    expect(extensionSource).not.toContain('"./scripts/patch-trigger-controller"');
    const core = await readFile(new URL("../../scripts/trigger-controller-patch-core.ts", import.meta.url), "utf8");
    expect(core).not.toContain("import.meta");
    expect(core).not.toContain("void main()");
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  (existsSync(".tmp/security-audit/managed-run-controller-4.5.16-isolated-cache.mjs") ? test : test.skip)("offline actual isolated-cache 4.5.16 bundle has the reviewed source/output hashes and patched JavaScript parses", async () => {
    const file = ".tmp/security-audit/managed-run-controller-4.5.16-isolated-cache.mjs";
    const source = await readFile(file, "utf8"), hash = (value: string) => createHash("sha256").update(value).digest("hex");
    expect(hash(source)).toBe(TRIGGER_CONTROLLER_SOURCE_SHA256);
    const patched = patchTriggerControllerSource(source);
    expect(hash(patched)).toBe(TRIGGER_CONTROLLER_PATCHED_SHA256);
    expect(patched).not.toContain(UNSAFE_ATTEMPT_LOG);
    expect(patched.split(SAFE_ATTEMPT_LOG)).toHaveLength(2);
    const runtime = globalThis as unknown as { Bun: { Transpiler: new (options: { loader: "js"; target: "bun" }) => { transformSync(source: string): string } } };
    expect(() => new runtime.Bun.Transpiler({ loader: "js", target: "bun" }).transformSync(patched)).not.toThrow();
    expect(() => patchTriggerControllerSource(source + "\n")).toThrow("differs from the reviewed");
  });

  (existsSync(".tmp/security-audit/managed-run-controller-4.5.16.mjs") ? test : test.skip)("archived prior packaging stays unchanged and cannot silently replace the current reviewed bundle", async () => {
    const source = await readFile(".tmp/security-audit/managed-run-controller-4.5.16.mjs", "utf8");
    expect(createHash("sha256").update(source).digest("hex")).toBe("bd5ac0181b73957cc34937addc593b9f1f45625e5b9eaebe7936689f85dd6222");
    expect(createHash("sha256").update(replaceAttemptLogStatement(source)).digest("hex")).toBe("30e7c4f177113f727cabd3d51a27b5348ce0f9a465dc5ca0723ef55357d338f9");
    expect(() => patchTriggerControllerSource(source)).toThrow("differs from the reviewed");
  });
});
