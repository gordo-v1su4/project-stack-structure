import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import type { BuildContext, BuildLayer } from "@trigger.dev/core/v3/build";
import { controllerLogContainment } from "../../trigger.controller-containment";
import { patchTriggerControllerSource, replaceAttemptLogStatement, SAFE_ATTEMPT_LOG,
  TRIGGER_CONTROLLER_SOURCE_SHA256, TRIGGER_CONTROLLER_PATCHED_SHA256, UNSAFE_ATTEMPT_LOG } from "../../scripts/patch-trigger-controller";

describe("app-image Trigger controller log containment", () => {
  (process.env.STACK_TRIGGER_CONFIG_LOADER_CLI_ROOT ? test : test.skip)("actual pinned 4.5.16 c12/jiti config loader imports the containment script without executing its CLI main", () => {
    const result = spawnSync(process.execPath, ["tests/helpers/loadTriggerConfig.mjs", process.env.STACK_TRIGGER_CONFIG_LOADER_CLI_ROOT!, process.cwd()],
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
    const manifest = { cliPackageVersion: "4.5.16", outputPath: "/build", runControllerEntryPoint: "/build/tmp/cli/managed-run-controller.mjs" };
    const extension = controllerLogContainment();
    extension.onBuildComplete!(context("dev"), manifest as never);
    expect(layers).toHaveLength(0);
    extension.onBuildComplete!(context("deploy"), manifest as never);
    expect(layers).toEqual([{ id: "stack-controller-log-containment", commands: ["bun scripts/patch-trigger-controller.ts --file 'tmp/cli/managed-run-controller.mjs'"] }]);
    expect(layers[0].image).toBe(undefined);
    for (const bad of [{ ...manifest, cliPackageVersion: "4.8.1" }, { ...manifest, runControllerEntryPoint: undefined },
      { ...manifest, runControllerEntryPoint: "/outside/managed-run-controller.mjs" }, { ...manifest, runControllerEntryPoint: "/build/tmp/worker.mjs" }]) {
      expect(() => extension.onBuildComplete!(context("deploy"), bad as never)).toThrow();
    }
    const config = await readFile(new URL("../../trigger.config.ts", import.meta.url), "utf8");
    expect(config).toContain("controllerLogContainment()");
    expect(config).toContain('"scripts/patch-trigger-controller.ts"');
  });

  (existsSync(".tmp/security-audit/managed-run-controller-4.5.16.mjs") ? test : test.skip)("offline actual 4.5.16 image bundle has the reviewed source/output hashes and patched JavaScript parses", async () => {
    const file = ".tmp/security-audit/managed-run-controller-4.5.16.mjs";
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
});
