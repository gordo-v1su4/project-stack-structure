import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

// Reviewed 4.5.16 bundle with the isolated build cache's module locations.
// The controller body is byte-identical to the prior reviewed bundle after
// its generated chunk specifiers and CLI path metadata are rebound.
// Pin the whole input and output: an SDK or bundler change needs explicit review.
export const TRIGGER_CONTROLLER_VERSION = "4.5.16";
export const TRIGGER_CONTROLLER_SOURCE_SHA256 = "06f44ebdc32828b1e65259c749e5ecd8c4e4d38daacdbdeb3d9e9d1799d9065b";
export const TRIGGER_CONTROLLER_PATCHED_SHA256 = "601eefa76f120098c948bb11adbd80dec88e7c5b10a6fc6923cd5e2e1fd1b152";
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

