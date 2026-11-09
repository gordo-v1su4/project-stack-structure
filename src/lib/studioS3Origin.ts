import { Agent } from "node:https";
import { isIP } from "node:net";
import { Readable } from "node:stream";
import type { S3ClientConfig } from "@aws-sdk/client-s3";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import { FetchHttpHandler } from "@smithy/fetch-http-handler";

/** Server-only connection routing. Endpoint, Host, TLS SNI and SigV4 authority stay
 * unchanged; browser presigned URLs still use the public endpoint. */
export function studioS3OriginOptions(
  endpoint: string,
  env: Record<string, string | undefined> = process.env,
): Pick<S3ClientConfig, "requestHandler"> {
  const address = env.RUSTFS_S3_ORIGIN_ADDRESS?.trim();
  if (!address) return {};
  const family = isIP(address);
  const url = new URL(endpoint);
  if (!family || url.protocol !== "https:" || isIP(url.hostname.replace(/^\[|\]$/g, ""))
    || url.username || url.password || url.search || url.hash) {
    throw new Error("Storage origin routing requires a literal origin IP and the configured HTTPS hostname endpoint.");
  }
  const hostname = url.hostname;
  const originAddress = address;
  type Request = Parameters<NodeHttpHandler["handle"]>[0];
  function route(request: Request) {
    if (request.protocol !== url.protocol || request.hostname.toLowerCase() !== hostname.toLowerCase()
      || (request.port || 443) !== Number(url.port || 443)
      || request.headers.host?.toLowerCase() !== url.host.toLowerCase()) {
      throw new Error("Storage origin routing cannot connect to another authority.");
    }
    const routed = request.clone();
    routed.hostname = originAddress;
    return routed;
  }
  if (process.versions.bun) {
    if (process.versions.bun.startsWith("1.3.") && url.port) {
      throw new Error("Pinned Bun storage origin routing requires the standard HTTPS port.");
    }
    // Pinned Bun ignores Agent TLS/DNS options and can reuse a connection across
    // names. Its native fetch accepts explicit SNI and connection isolation.
    class BunOriginHandler extends FetchHttpHandler {
      override async handle(request: Request, options?: Parameters<NodeHttpHandler["handle"]>[1]) {
        const routed = route(request);
        if (family === 6) routed.hostname = `[${originAddress}]`;
        const result = await super.handle(routed, options);
        const body = result.response.body;
        if (body instanceof Blob) result.response.body = Readable.fromWeb(body.stream() as unknown as Parameters<typeof Readable.fromWeb>[0]);
        else if (body && typeof body.getReader === "function") result.response.body = Readable.fromWeb(body);
        return result;
      }
    }
    return { requestHandler: new BunOriginHandler({
      keepAlive: false,
      customFetch: request => {
        const options: RequestInit & { tls: { serverName: string; rejectUnauthorized: true }; decompress: false; timeout: false } = {
          tls: { serverName: hostname, rejectUnauthorized: true },
          keepalive: false, redirect: "manual", decompress: false, timeout: false,
        };
        return fetch(request, options);
      },
    }) };
  }
  const agent = new Agent({ keepAlive: true, maxSockets: 50, servername: hostname });
  class OriginHandler extends NodeHttpHandler {
    override async handle(request: Request, options?: Parameters<NodeHttpHandler["handle"]>[1]) {
      return super.handle(route(request), options);
    }
  }
  return { requestHandler: new OriginHandler({ httpsAgent: agent }) };
}
