import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:https";
import { Readable } from "node:stream";
import { gzipSync } from "node:zlib";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { studioS3OriginOptions } from "../../src/lib/studioS3Origin";

// Separate process keeps test-only CA trust fixed for the entire TLS session.
const [cert, key, otherCert, otherKey] = await Promise.all(process.argv.slice(2, 6).map(file => readFile(file)));
const payload = Buffer.from(Array.from({ length: 128 * 1024 }, (_, index) => index % 251));
const compressed = gzipSync(payload), uploads: Buffer[] = [];
const requests: Array<{ host?: string; condition?: string; range?: string; authorization?: string }> = [];
const server = createServer({ cert, key }, async (req, res) => {
  requests.push({ host: req.headers.host, condition: req.headers["if-match"], range: req.headers.range, authorization: req.headers.authorization });
  if (req.method === "PUT") {
    const chunks: Buffer[] = [];
    for await (const bytes of req) chunks.push(Buffer.from(bytes));
    uploads.push(Buffer.concat(chunks));
    res.writeHead(200, { etag: '"uploaded"', "content-length": "0" }); res.end(); return;
  }
  if (req.url?.includes("encoded.bin")) {
    res.writeHead(200, { "content-encoding": "gzip", "content-length": String(compressed.length) }); res.end(compressed); return;
  }
  if (req.url?.includes("redirect.bin")) {
    const port = (server.address() as import("node:net").AddressInfo).port;
    res.writeHead(307, { location: `https://127.0.0.1:${port}/studio/redirect-target` }); res.end(); return;
  }
  if (req.headers["if-match"] !== '"pinned"') {
    res.writeHead(412, { "content-type": "application/xml" }); res.end("<Error><Code>PreconditionFailed</Code></Error>"); return;
  }
  res.writeHead(206, { etag: '"pinned"', "content-length": "1", "content-range": "bytes 0-0/4" }); res.end("x");
});
let untrustedRequests = 0;
const untrustedServer = createServer({ cert: otherCert, key: otherKey }, (_req, res) => { untrustedRequests++; res.end(); });
const pinnedBun = process.versions.bun?.startsWith("1.3.");
await new Promise<void>(resolve => server.listen(pinnedBun ? 443 : 0, "127.0.0.1", resolve));
const port = (server.address() as import("node:net").AddressInfo).port;
await new Promise<void>(resolve => untrustedServer.listen(port, "127.0.0.2", resolve));
const endpoint = `https://storage.example.test:${port}`, authority = new URL(endpoint).host;
const clients: S3Client[] = [];
function client(url = endpoint, address = "127.0.0.1") {
  const result = new S3Client({ endpoint: url, region: "us-east-1", forcePathStyle: true, maxAttempts: 1,
    requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED",
    credentials: { accessKeyId: "synthetic-access", secretAccessKey: "synthetic-secret" },
    ...studioS3OriginOptions(url, { RUSTFS_S3_ORIGIN_ADDRESS: address }),
  });
  clients.push(result); return result;
}
try {
  const x = client(), input = { Bucket: "studio", Key: "pinned.bin", IfMatch: '"pinned"', Range: "bytes=0-0" };
  if (pinnedBun) assert.throws(() => client("https://storage.example.test:444"), /standard HTTPS port/);
  await assert.rejects(client(endpoint, "127.0.0.2").send(new GetObjectCommand(input)));
  await assert.rejects(client(`https://wrong.example.test:${port}`).send(new GetObjectCommand(input)));
  assert.equal(requests.length, 0); assert.equal(untrustedRequests, 0);
  const result = await x.send(new GetObjectCommand(input));
  assert.equal(await result.Body!.transformToString(), "x"); assert.equal(result.ETag, '"pinned"');
  assert.equal(requests[0].host, authority); assert.equal(requests[0].condition, '"pinned"'); assert.equal(requests[0].range, "bytes=0-0");
  assert.ok(requests[0].authorization?.includes("host;if-match;range;"));
  await assert.rejects(x.send(new GetObjectCommand({ ...input, IfMatch: '"wrong"' })), error => (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 412);
  await assert.rejects(client(`https://wrong.example.test:${port}`).send(new GetObjectCommand(input)));
  assert.equal(requests.length, 2); // Wrong name also fails after a trusted connection.
  const signed = new URL(await getSignedUrl(x, new GetObjectCommand(input), { expiresIn: 60 }));
  assert.equal(signed.host, authority); assert.ok(!signed.href.includes("127.0.0.1"));
  for (const body of [payload, Readable.from([payload.subarray(0, 1000), payload.subarray(1000)])]) {
    await x.send(new PutObjectCommand({ Bucket: "studio", Key: "output.bin", Body: body, ContentLength: payload.length }));
  }
  assert.deepEqual(uploads, [payload, payload]);
  const encoded = await x.send(new GetObjectCommand({ Bucket: "studio", Key: "encoded.bin" }));
  assert.deepEqual(Buffer.from(await encoded.Body!.transformToByteArray()), compressed);
  const count = requests.length;
  await assert.rejects(x.send(new GetObjectCommand({ Bucket: "studio", Key: "redirect.bin" })), error => (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 307);
  assert.equal(requests.length, count + 1);
  await assert.rejects(x.send(new GetObjectCommand(input), { abortSignal: AbortSignal.abort() }), error => (error as Error).name === "AbortError");
  assert.equal(requests.length, count + 1);
  console.log(JSON.stringify({ passed: true, runtime: process.versions.bun || process.version, wrongNameBeforeAndAfterTrustedConnection: true,
    untrustedChainRejected: true, wrongEtagRejected: true, binaryAndStreamedUploadBytes: payload.length, encodedBytesPreserved: true,
    redirectsRejected: true, abortedBeforeRequest: true, signedAuthorityPreserved: true, presignedPublicAuthority: true }));
} finally {
  for (const x of clients) x.destroy();
  await Promise.all([server, untrustedServer].map(server => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))));
}
