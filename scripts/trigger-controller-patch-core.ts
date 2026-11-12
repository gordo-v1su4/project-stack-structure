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
// Exact 4.5.16 import-rebound bundle: controller body is byte-identical after
// replacing three reviewed generated chunk names. No generic normalization.
export const TRIGGER_CONTROLLER_REBOUND_SOURCE_SHA256 = "48744f08e1b31704279ff6245208e4ef6520299401480dafd96e4b6f33fd3e62";
export const TRIGGER_CONTROLLER_REBOUND_PATCHED_SHA256 = "9fa7a554fafd1c8798d9f2b816d724e3ce0b40391029a4a5f4e63a1825475a42";
// V1S-464 review-task bundle: byte-identical deployed controller body after
// exactly CEB7UULU -> NPA5XLGE, 7Q5UQ7TD -> I3EONRL4 and FT6LMJRK -> C5NT3V3B
// generated import rebinding. Admit this whole-file pair, never arbitrary imports.
export const TRIGGER_CONTROLLER_REVIEW_SOURCE_SHA256 = "e835280f746a18c40dce3692bc5e59fb573397d5c40d21e0f00d8c8e1535774c";
export const TRIGGER_CONTROLLER_REVIEW_PATCHED_SHA256 = "69e8d9923ced1213f0c277dda8521cacf63f7a113f183660e14b04e421d3fac4";
export const TRIGGER_CONTROLLER_REVIEWED_PAIRS: Readonly<Record<string, string>> = Object.freeze({
  [TRIGGER_CONTROLLER_SOURCE_SHA256]: TRIGGER_CONTROLLER_PATCHED_SHA256,
  [TRIGGER_CONTROLLER_REBOUND_SOURCE_SHA256]: TRIGGER_CONTROLLER_REBOUND_PATCHED_SHA256,
  [TRIGGER_CONTROLLER_REVIEW_SOURCE_SHA256]: TRIGGER_CONTROLLER_REVIEW_PATCHED_SHA256,
});
export function isReviewedPatchedControllerSha256(hash: string): boolean {
  return Object.values(TRIGGER_CONTROLLER_REVIEWED_PAIRS).includes(hash);
}
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
  const sourceSha256 = digest(source);
  // Repeating containment on an exact known output is safe; arbitrary sources
  // containing the safe statement are never accepted by this branch.
  if (isReviewedPatchedControllerSha256(sourceSha256)) return source;
  const expectedPatchedSha256 = TRIGGER_CONTROLLER_REVIEWED_PAIRS[sourceSha256];
  if (!expectedPatchedSha256) {
    throw new Error("Trigger controller source differs from the reviewed 4.5.16 bundle; refusing to build an unreviewed image.");
  }
  const patched = replaceAttemptLogStatement(source);
  if (digest(patched) !== expectedPatchedSha256) {
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
  if (digest(await readFile(absolute, "utf8")) !== digest(patched)) {
    throw new Error("Trigger controller containment could not verify the written bundle.");
  }
}

