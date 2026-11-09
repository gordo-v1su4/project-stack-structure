import { describe, expect, test } from "bun:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { assertProductionTriggerKey } from "../../scripts/app-vm-trigger-key.mjs";

const production = "tr_prod_0123456789abcdefghijklmn";
const additional = "tr_prod_sk_0123456789abcdefghijklmn";
const rejected = [undefined, null, "", " ", "[SENSITIVE]", "tr_dev_0123456789abcdefghijklmn", "tr_stg_0123456789abcdefghijklmn",
  "tr_preview_0123456789abcdefghijklmn", "pk_prod_0123456789abcdefghijklmn", "tr_prod_", "tr_prod_sk_short",
  "TR_PROD_0123456789abcdefghijklmn", ` ${production}`, `${production} `, `${production}\n`, `${production}\r`,
  `${production}\u0000`, `${production}\tmore`, `'${production}'`, `"${production}"`, `${production}_extra`, 42, {}];

describe("App VM production Trigger credential class", () => {
  test("accepts both supported production key classes without returning credentials", () => {
    expect(assertProductionTriggerKey(production)).toBe(undefined);
    expect(assertProductionTriggerKey(additional)).toBe(undefined);
  });

  test("rejects missing, nonproduction, malformed, quoted and whitespace-bearing values with one fixed error", () => {
    const messages = new Set<string>();
    for (const value of rejected) {
      try { assertProductionTriggerKey(value); throw new Error("Unexpected acceptance"); }
      catch (error) {
        const message = (error as Error).message;
        messages.add(message);
        expect(message).toContain("Production deployment requires");
        if (typeof value === "string" && value.length > 5) expect(message).not.toContain(value);
      }
    }
    expect(messages.size).toBe(1);
  });

  test("actual deploy entrypoint rejects before any filesystem, Docker or Dockhand mutation", async () => {
    // Execute the real script with injected imports and fake file reads. No
    // credential files, child processes or network APIs are accessed.
    const source = readFileSync(new URL("../../scripts/deploy-app-vm.mjs", import.meta.url), "utf8").replace(/^import .*;\r?$/gm, "");
    for (const key of ["tr_dev_fixture", "", "tr_unknown_fixture"]) {
      const mutations: string[] = [];
      const mutate = () => { mutations.push("mutation"); throw new Error("Mutation reached"); };
      const run = runInNewContext(`(async () => { ${source}\n })()`, {
        assert, assertProductionTriggerKey, process: { argv: ["node", "deploy", "a".repeat(40)],
          env: { GITHUB_REPOSITORY: "gordo-v1su4/project-stack-structure", GITHUB_REF: "refs/heads/main" } },
        readFileSync: (path: string) => path.endsWith("deploy.env") ? "DOCKHAND_URL=http://100.105.199.93:13000\nDOCKHAND_ENV_ID=3" : `TRIGGER_SECRET_KEY=${key}`,
        mkdirSync: mutate, writeFileSync: mutate, spawnSync: mutate, fetch: mutate,
        realpathSync: mutate, statfsSync: mutate, resolve: mutate, createHash: mutate,
      });
      await expect(run).rejects.toThrow("Production deployment requires");
      expect(mutations).toEqual([]);
    }
  });
});
