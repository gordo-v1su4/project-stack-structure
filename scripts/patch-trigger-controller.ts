import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

// Verified from this application's actual 4.5.16 production controller bundle.
// Pin the whole input and output: an SDK or bundler change needs explicit review.
export const TRIGGER_CONTROLLER_VERSION = "4.5.16";
export const TRIGGER_CONTROLLER_SOURCE_SHA256 = "bd5ac0181b73957cc34937addc593b9f1f45625e5b9eaebe7936689f85dd6222";
export const TRIGGER_CONTROLLER_PATCHED_SHA256 = "30e7c4f177113f727cabd3d51a27b5348ce0f9a465dc5ca0723ef55357d338f9";
export const UNSAFE_ATTEMPT_LOG = 'this.sendDebugLog("started attempt", { start: start.data });';
export const SAFE_ATTEMPT_LOG = 'this.sendDebugLog("started attempt", { runId: this.runFriendlyId, attemptNumber });';
const digest = (source: string) => createHash("sha256").update(source).digest("hex");

/** One exact producer replacement; never changes start.data or execution. */
export function replaceAttemptLogStatement(source: string): string {
  if (source.split(UNSAFE_ATTEMPT_LOG).length !== 2) {
    throw new Error("Trigger controller containment requires exactly one known attempt-log statement.");
  }
  return source.replace(UNSAFE_ATTEMPT_LOG, SAFE_ATTEMPT_LOG);
}

export function patchTriggerControllerSource(source: string): string {
  if (digest(source) !== TRIGGER_CONTROLLER_SOURCE_SHA256) {
    throw new Error("Trigger controller source differs from the reviewed 4.5.16 bundle; refusing to build an unreviewed image.");
  }
  const patched = replaceAttemptLogStatement(source);
  if (digest(patched) !== TRIGGER_CONTROLLER_PATCHED_SHA256) {
    throw new Error("Trigger controller containment output failed its pinned checksum.");
  }
  return patched;
}

export async function patchTriggerControllerFile(file: string): Promise<void> {
  const absolute = path.resolve(file), relative = path.relative(process.cwd(), absolute);
  if (!relative || path.isAbsolute(relative) || relative.split(path.sep).includes("..")
    || path.basename(absolute) !== "managed-run-controller.mjs") {
    throw new Error("Trigger controller containment only accepts the image's managed controller inside its build directory.");
  }
  const source = await readFile(absolute, "utf8"), patched = patchTriggerControllerSource(source);
  await writeFile(absolute, patched);
  if (digest(await readFile(absolute, "utf8")) !== TRIGGER_CONTROLLER_PATCHED_SHA256) {
    throw new Error("Trigger controller containment could not verify the written bundle.");
  }
}

async function main() {
  if (process.argv.length !== 4 || process.argv[2] !== "--file") {
    throw new Error("Usage: bun scripts/patch-trigger-controller.ts --file CONTROLLER");
  }
  await patchTriggerControllerFile(process.argv[3]);
  console.log("Trigger controller attempt logging: metadata allowlist verified.");
}

// Trigger 4.5.16 loads config imports through a CommonJS transform. Keep the
// imported module inert, without top-level await or evaluating import.meta.url.
if ((import.meta as ImportMeta & { main?: boolean }).main) {
  void main().catch(error => {
    console.error(error instanceof Error ? error.message : "Trigger controller containment failed.");
    process.exitCode = 1;
  });
}
