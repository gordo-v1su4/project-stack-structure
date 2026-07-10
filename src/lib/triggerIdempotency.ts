import { createHash } from "node:crypto";

export function createTriggerIdempotencyKey(scope: string, parts: Array<string | number | null | undefined>) {
  const digest = createHash("sha256")
    .update(parts.map((part) => String(part ?? "")).join("\u0000"))
    .digest("hex");
  return `${scope}:${digest}`;
}
