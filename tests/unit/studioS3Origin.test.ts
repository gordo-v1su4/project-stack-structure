import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import { FetchHttpHandler } from "@smithy/fetch-http-handler";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { studioS3OriginOptions } from "@/lib/studioS3Origin";

const options = (endpoint = "https://storage.example.test", address = "127.0.0.1") =>
  studioS3OriginOptions(endpoint, { RUSTFS_S3_ORIGIN_ADDRESS: address });
function handlerFor(endpoint?: string, address?: string): NodeHttpHandler | FetchHttpHandler {
  return options(endpoint, address).requestHandler as NodeHttpHandler | FetchHttpHandler;
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

  test("IPv4 and IPv6 routing reject a changed authority before connecting", async () => {
    for (const address of ["127.0.0.1", "::1"]) {
      const handler = handlerFor(undefined, address);
      try {
        const request: Parameters<NodeHttpHandler["handle"]>[0] = { protocol: "https:", hostname: "storage.example.test", port: 443, method: "GET", path: "/", headers: { host: "storage.example.test" }, query: {}, clone() { return this; } };
        for (const changed of [{ protocol: "http:" }, { hostname: "another.example.test" }, { port: 444 }, { headers: { host: "another.example.test" } }]) {
          await expect(handler.handle({ ...request, ...changed, clone: () => request })).rejects.toThrow("another authority");
        }
      } finally { handler.destroy(); }
    }
  });

  test("real SDK preserves signed bytes and rejects TLS, condition, redirect and abort failures", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "studio-s3-tls-"));
    const gitOpenSsl = "C:/Program Files/Git/usr/bin/openssl.exe";
    const openssl = process.platform === "win32" && existsSync(gitOpenSsl) ? gitOpenSsl : "openssl";
    const certs = ["trusted", "untrusted"].map(name => ({ cert: path.join(directory, name + ".pem"), key: path.join(directory, name + "-key.pem") }));
    try {
      for (const files of certs) execFileSync(openssl, ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=storage.example.test", "-addext", "subjectAltName=DNS:storage.example.test", "-keyout", files.key, "-out", files.cert], { stdio: "ignore" });
      const output = execFileSync(process.execPath, [path.resolve("tests/helpers/studioS3TlsProbe.ts"), certs[0].cert, certs[0].key, certs[1].cert, certs[1].key], {
        env: { ...process.env, NODE_EXTRA_CA_CERTS: certs[0].cert }, encoding: "utf8", timeout: 10_000,
      });
      expect(JSON.parse(output).passed).toBe(true);
    } finally { await rm(directory, { recursive: true, force: true }); }
  }, 15_000);
});
