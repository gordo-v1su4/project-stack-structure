import { expect, test } from "bun:test";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Readable } from "node:stream";

test("the actual S3 serializer forwards and signs the exact pinned If-Match header", async () => {
  const etag = '"pinned-reference-version"';
  let calls = 0;
  const client = new S3Client({ endpoint: "https://storage.example.test", region: "us-east-1", forcePathStyle: true,
    credentials: { accessKeyId: "test-only-access", secretAccessKey: "test-only-secret" },
    requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED", maxAttempts: 1,
    requestHandler: { handle: async (request: { headers: Record<string, string> }) => {
      calls++;
      expect(request.headers["if-match"]).toBe(etag);
      expect(/SignedHeaders=[^, ]*if-match/.test(request.headers.authorization)).toBe(true);
      return { response: { statusCode: 200, headers: { etag, "content-type": "image/png", "content-length": "3" }, body: Readable.from([Buffer.from([1, 2, 3])]) } };
    } },
  });
  try {
    const result = await client.send(new GetObjectCommand({ Bucket: "studio", Key: "owned/reference.png", IfMatch: etag }));
    expect(result.ETag).toBe(etag); expect(await result.Body!.transformToByteArray()).toEqual(new Uint8Array([1, 2, 3]));
    expect(calls).toBe(1);
  } finally { client.destroy(); }
});
