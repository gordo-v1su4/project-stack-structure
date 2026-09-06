import { describe, expect, test } from "bun:test";
import { DIRECT_UPLOAD_PART_BYTES, signUploadReceipt, verifyUploadReceipt, validateDirectUploadInput, validateStoredParts } from "@/lib/directStorageUpload";

describe("direct storage upload boundaries", () => {
  const receipt = { owner: "github-alice", bucket: "stack-structure", key: "media-uploads/github-alice/source/unique/song.wav", uploadId: "upload-1", size: 12, mime: "audio/wav", expires: Date.now() + 60000 };
  test("rejects tampered, expired, wrong-owner and wrong-bucket receipts", () => {
    const signed = signUploadReceipt(receipt, "test-secret");
    expect(verifyUploadReceipt(signed, receipt.owner, receipt.bucket, "test-secret")).toEqual(receipt);
    for (const token of [signed + "x", signUploadReceipt({ ...receipt, expires: 0 }, "test-secret")]) {
      expect(() => verifyUploadReceipt(token, receipt.owner, receipt.bucket, "test-secret")).toThrow();
    }
    expect(() => verifyUploadReceipt(signed, "github-bob", receipt.bucket, "test-secret")).toThrow();
    expect(() => verifyUploadReceipt(signed, receipt.owner, "another-bucket", "test-secret")).toThrow();
    expect(() => verifyUploadReceipt(signUploadReceipt({ ...receipt, key: "media-uploads/github-bob/source.wav" }, "test-secret"), receipt.owner, receipt.bucket, "test-secret")).toThrow();
  });
  test("rejects traversal, active image formats, and invalid sizes before starting storage work", () => {
    const input = { fileName: "sheet.png", contentType: "image/png", size: 8_000_000, folder: "media-uploads/reference-assets/character-1" };
    expect(validateDirectUploadInput(input).size).toBe(8_000_000);
    for (const folder of ["media-uploads/../other", "media-uploads/a//b", "https://other/key", "/tmp/image", "media-uploads/a%2fb"])
      expect(() => validateDirectUploadInput({ ...input, folder })).toThrow();
    for (const size of [0, -1, 1.5, Number.NaN, 3 * 1024 ** 3])
      expect(() => validateDirectUploadInput({ ...input, size })).toThrow();
    expect(() => validateDirectUploadInput({ ...input, contentType: "image/svg+xml" })).toThrow();
    expect(() => validateDirectUploadInput({ ...input, fileName: "../sheet.png" })).toThrow();
  });
  test("completes only correctly sized contiguous storage parts", () => {
    const parts = [{ PartNumber: 1, ETag: "first", Size: DIRECT_UPLOAD_PART_BYTES }, { PartNumber: 2, ETag: "last", Size: 7 }];
    expect(validateStoredParts(parts, DIRECT_UPLOAD_PART_BYTES + 7)).toHaveLength(2);
    for (const bad of [parts.slice(0, 1), [...parts].reverse(), [{ ...parts[0], Size: 1 }, parts[1]], [parts[0], { ...parts[1], ETag: undefined }]])
      expect(() => validateStoredParts(bad, DIRECT_UPLOAD_PART_BYTES + 7)).toThrow();
  });
});
