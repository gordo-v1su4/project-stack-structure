import { Agent } from "node:https";
import { isIP, type LookupFunction } from "node:net";
import type { S3ClientConfig } from "@aws-sdk/client-s3";

/** Server-only DNS routing. Endpoint, Host, TLS SNI and SigV4 authority stay
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
  const lookup: LookupFunction = (requested, options, callback) => {
    if (requested.toLowerCase() !== hostname.toLowerCase()) {
      callback(new Error("Storage origin routing cannot resolve another authority."), "", family);
      return;
    }
    if (options.family && options.family !== family) {
      callback(new Error("Storage origin address does not match the requested address family."), "", family);
      return;
    }
    callback(null, options.all ? [{ address, family }] : address, family);
  };
  return { requestHandler: { httpsAgent: new Agent({ keepAlive: true, maxSockets: 50, servername: hostname, lookup }) } };
}
