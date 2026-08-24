/**
 * Hydrate .env.local from Bitwarden Secrets Manager (project hermes_keys).
 *
 * BWS is the canonical store; every machine pulls its own values with its own
 * BWS_ACCESS_TOKEN. Secrets never pass through chat, git, or other agents.
 *
 * Usage:
 *   BWS_ACCESS_TOKEN=... bun run scripts/sync-local-env.ts
 *   # or with ~/.hermes/.env present, the token is picked up automatically.
 *
 * Values are written as single-quoted shell literals to .env.local (mode 600).
 * Existing .env.local is preserved as .env.local.bak before overwrite.
 */

import { copyFileSync, existsSync, readFileSync, chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type Mapping = { env: string; bws: string };

function readToken(): string {
  const direct = process.env.BWS_ACCESS_TOKEN?.trim();
  if (direct) return direct;
  const hermesEnv = join(process.env.HOME ?? "", ".hermes/.env");
  if (existsSync(hermesEnv)) {
    for (const line of readFileSync(hermesEnv, "utf8").split("\n")) {
      const match = /^BWS_ACCESS_TOKEN=(.+)$/.exec(line.trim());
      if (match) return match[1].trim();
    }
  }
  throw new Error("BWS_ACCESS_TOKEN not set and ~/.hermes/.env has no token.");
}

function bws(args: string[], token: string): string {
  const result = Bun.spawnSync(["bws", ...args], {
    env: { ...process.env, BWS_ACCESS_TOKEN: token },
    stdout: "pipe",
    stderr: "pipe",
  });
  const out = result.stdout.toString();
  if (result.exitCode !== 0) {
    throw new Error(`bws ${args[0]} ${args[1] ?? ""} failed: ${result.stderr.toString().slice(0, 200)}`);
  }
  return out;
}

async function main() {
  const token = readToken();
  const manifest = JSON.parse(readFileSync("config/secrets.manifest.json", "utf8")) as Record<string, unknown> & {
    sections?: string[];
  };
  const sections = ["required", "applicationProduction", "triggerProduction", "triggerDeployment"];

  // Manifest mappings; later sections win for a repeated env name.
  // TRIGGER_SECRET_KEY must resolve to the PROD secret because local dispatch
  // targets the self-hosted production control plane (same as Vercel).
  const envToBws = new Map<string, string>();
  const addPair = (envName: string, bwsName: string) => {
    envToBws.set(envName, bwsName);
  };
  for (const section of sections) {
    for (const mapping of ((manifest[section] as Mapping[] | undefined) ?? [])) {
      addPair(mapping.env, mapping.bws);
    }
  }
  // Extra app-level vars that live in BWS but have no manifest section yet.
  addPair("HIGGSFIELD_CREDENTIALS_JSON", "STACK_STRUCTURE_HIGGSFIELD_CREDENTIALS_JSON");
  addPair("HIGGSFIELD_WORKSPACE_ID", "STACK_STRUCTURE_HIGGSFIELD_WORKSPACE_ID");
  addPair("HIGGSFIELD_ALLOWED_IMAGE_HOSTS", "STACK_STRUCTURE_HIGGSFIELD_ALLOWED_IMAGE_HOSTS");
  const pairs = new Map<string, string[]>();
  for (const [envName, bwsName] of envToBws) {
    const existing = pairs.get(bwsName);
    if (existing) existing.push(envName);
    else pairs.set(bwsName, [envName]);
  }

  // Resolve key -> id once; `bws secret get` only accepts IDs.
  const idByKey = new Map<string, string>();
  for (const record of JSON.parse(bws(["secret", "list"], token)) as Array<{ id: string; key: string }>) {
    idByKey.set(record.key, record.id);
  }

  const lines: string[] = [];
  const missing: string[] = [];
  for (const [bwsName, envNames] of pairs) {
    const id = idByKey.get(bwsName);
    if (!id) {
      missing.push(bwsName);
      continue;
    }
    const value = (JSON.parse(bws(["secret", "get", id], token)) as { value: string }).value.replace(/[\r\n]+/g, "");
    for (const envName of envNames) {
      lines.push(`${envName}='${value.replace(/'/g, "'\\''")}'`);
    }
  }

  if (lines.length === 0) throw new Error(`No secrets resolved. Missing: ${missing.join(", ")}`);

  if (existsSync(".env.local")) copyFileSync(".env.local", ".env.local.bak");
  writeFileSync(".env.local", `${lines.join("\n")}\n`, { mode: 0o600 });
  chmodSync(".env.local", 0o600);

  console.log(
    `.env.local hydrated: ${lines.length} vars from ${pairs.size - missing.length}/${pairs.size} BWS secrets.` +
      (missing.length ? ` Missing (verify as MISSING): ${missing.join(", ")}` : ""),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
