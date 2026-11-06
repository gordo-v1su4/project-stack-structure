import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { verifyExportMediaIntegrity } from "@/lib/exportMediaIntegrity";

test("downloaded H3 media must match the canonical server hash before FFmpeg receives it", () => {
  const original = new Uint8Array([1, 2, 3]);
  const expectedSha256 = createHash("sha256").update(original).digest("hex");
  verifyExportMediaIntegrity({ expectedSha256 }, original);
  expect(() => verifyExportMediaIntegrity({ expectedSha256 }, new Uint8Array([1, 2, 4]))).toThrow("bytes changed");
  expect(() => verifyExportMediaIntegrity({ expectedSha256: "invalid" }, original)).toThrow("bytes changed");
  verifyExportMediaIntegrity({}, original);
});
