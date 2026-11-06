import { createHash } from "node:crypto";

/** expectedSha256 is attached by the server from its canonical worker result, never forwarded from browser JSON. */
export function verifyExportMediaIntegrity(input: { expectedSha256?: string }, bytes: Uint8Array) {
  if (input.expectedSha256 === undefined) return;
  if (!/^[a-f0-9]{64}$/.test(input.expectedSha256)
    || createHash("sha256").update(bytes).digest("hex") !== input.expectedSha256) {
    throw new Error("Generated video bytes changed after identity verification. Review the canonical take before export.");
  }
}
