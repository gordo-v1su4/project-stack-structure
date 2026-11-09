import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createServer, type Agent } from "node:https";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { studioS3OriginOptions } from "@/lib/studioS3Origin";

const options = (endpoint = "https://storage.example.test", address = "127.0.0.1") =>
  studioS3OriginOptions(endpoint, { RUSTFS_S3_ORIGIN_ADDRESS: address });
function agentFor(endpoint?: string, address?: string): Agent {
  return (options(endpoint, address).requestHandler as { httpsAgent: Agent }).httpsAgent;
}

describe("server-only signed S3 origin routing", () => {
  test("remains opt-in and rejects invalid routing configuration", () => {
    expect(studioS3OriginOptions("https://storage.example.test", {})).toEqual({});
    for (const address of ["storage.internal", "127.0.0.1:9000", "https://127.0.0.1"]) {
      expect(() => options(undefined, address)).toThrow();
    }
    for (const endpoint of ["http://storage.example.test", "https://127.0.0.1", "https://[::1]", "https://user:pass@storage.example.test", "https://storage.example.test?route=other", "https://storage.example.test#other"]) {
      expect(() => options(endpoint)).toThrow();
    }
  });

  test("lookup pins one authority, supports both lookup modes, and fails closed", async () => {
    for (const [address, family] of [["127.0.0.1", 4], ["::1", 6]] as const) {
      const agent = agentFor(undefined, address);
      const lookup = agent.options.lookup!;
      const resolve = (host: string, all: boolean, requestedFamily = 0) => new Promise((resolve, reject) => {
        lookup(host, { all, family: requestedFamily }, (error, result) => error ? reject(error) : resolve(result));
      });
      try {
        expect(await resolve("STORAGE.EXAMPLE.TEST", false)).toBe(address);
        expect(await resolve("storage.example.test", true)).toEqual([{ address, family }]);
        await expect(resolve("another.example.test", false)).rejects.toThrow("another authority");
        await expect(resolve("storage.example.test", false, family === 4 ? 6 : 4)).rejects.toThrow("address family");
        expect(agent.options.rejectUnauthorized).not.toBe(false);
        expect(agent.options.servername).toBe("storage.example.test");
      } finally { agent.destroy(); }
    }
  });

  test("real SDK keeps signed Host, Range and IfMatch over validated TLS; 412 never downgrades", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "studio-s3-tls-"));
    const gitOpenSsl = "C:/Program Files/Git/usr/bin/openssl.exe";
    const openssl = process.platform === "win32" && existsSync(gitOpenSsl) ? gitOpenSsl : "openssl";
    let cert: Buffer, key: Buffer;
    try {
      execFileSync(openssl, ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=storage.example.test", "-addext", "subjectAltName=DNS:storage.example.test", "-keyout", path.join(directory, "key.pem"), "-out", path.join(directory, "cert.pem")], { stdio: "ignore" });
      [cert, key] = await Promise.all([readFile(path.join(directory, "cert.pem")), readFile(path.join(directory, "key.pem"))]);
    } finally { await rm(directory, { recursive: true, force: true }); }
    const requests: Array<{ host?: string; ifMatch?: string; range?: string; authorization?: string; servername?: string }> = [];
    const server = createServer({ key, cert }, (req, res) => {
      requests.push({ host: req.headers.host, ifMatch: req.headers["if-match"], range: req.headers.range, authorization: req.headers.authorization, servername: (req.socket as import("node:tls").TLSSocket).servername || undefined });
      if (req.headers["if-match"] !== '"pinned"') {
        res.writeHead(412, { "content-type": "application/xml" });
        res.end("<Error><Code>PreconditionFailed</Code><Message>Object changed</Message></Error>");
      } else {
        res.writeHead(206, { etag: '"pinned"', "content-length": "1", "content-range": "bytes 0-0/4" });
        res.end("x");
      }
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as import("node:net").AddressInfo).port;
    const endpoint = `https://storage.example.test:${port}`;
    const makeClient = (url = endpoint, trust = true) => {
      const agent = agentFor(url);
      if (trust) agent.options.ca = cert; // Trust only this test's ephemeral CA; production uses default trust.
      return new S3Client({ endpoint: url, region: "us-east-1", forcePathStyle: true, maxAttempts: 1,
        credentials: { accessKeyId: "synthetic-access", secretAccessKey: "synthetic-secret" }, requestHandler: { httpsAgent: agent } });
    };
    const client = makeClient(), untrusted = makeClient(endpoint, false), wrongName = makeClient(`https://wrong.example.test:${port}`);
    try {
      const input = { Bucket: "studio", Key: "media/pinned.bin", IfMatch: '"pinned"', Range: "bytes=0-0" };
      const result = await client.send(new GetObjectCommand(input));
      expect(await result.Body!.transformToString()).toBe("x");
      expect(result.ETag).toBe('"pinned"');
      expect(requests[0]).toMatchObject({ host: `storage.example.test:${port}`, ifMatch: '"pinned"', range: "bytes=0-0", servername: "storage.example.test" });
      expect(requests[0].authorization).toContain("host;if-match;range;");
      await expect(client.send(new GetObjectCommand({ ...input, IfMatch: '"changed"' }))).rejects.toMatchObject({ $metadata: { httpStatusCode: 412 } });
      expect(requests).toHaveLength(2);
      expect(requests[1].ifMatch).toBe('"changed"');
      // An origin IP must never disable either chain trust or hostname validation.
      await expect(untrusted.send(new GetObjectCommand(input))).rejects.toThrow();
      await expect(wrongName.send(new GetObjectCommand(input))).rejects.toThrow();
      expect(requests).toHaveLength(2);
      const signed = new URL(await getSignedUrl(client, new GetObjectCommand(input), { expiresIn: 60 }));
      expect(signed.host).toBe(`storage.example.test:${port}`);
      expect(signed.href).not.toContain("127.0.0.1");
    } finally {
      client.destroy(); untrusted.destroy(); wrongName.destroy();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  }, 15_000);
});
