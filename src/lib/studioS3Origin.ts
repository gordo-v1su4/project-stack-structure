import { Agent } from "node:https";
import { isIP } from "node:net";
import type { S3ClientConfig } from "@aws-sdk/client-s3";
import { NodeHttpHandler } from "@smithy/node-http-handler";

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
  const agent = new Agent({ keepAlive: true, maxSockets: 50, servername: hostname });
  class OriginHandler extends NodeHttpHandler {
      // Bun 1.3.3 ignores Agent.lookup. Pin the socket destination explicitly,
      // after signing; retain the signed Host and validate TLS against its SNI.
      override handle(
        request: Parameters<NodeHttpHandler["handle"]>[0],
        options?: Parameters<NodeHttpHandler["handle"]>[1],
      ) {
        if (request.protocol !== url.protocol || request.hostname.toLowerCase() !== hostname.toLowerCase()
          || (request.port || 443) !== Number(url.port || 443)
          || request.headers.host?.toLowerCase() !== url.host.toLowerCase()) {
          return Promise.reject(new Error("Storage origin routing cannot connect to another authority."));
        }
        const routed = request.clone();
        routed.hostname = originAddress;
        return super.handle(routed, options);
      }
  }
  return { requestHandler: new OriginHandler({ httpsAgent: agent }) };
}
