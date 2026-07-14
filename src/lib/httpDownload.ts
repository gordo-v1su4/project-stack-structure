import * as http from "node:http";
import * as https from "node:https";

export type HttpDownload = {
  bytes: ArrayBuffer;
  contentType: string;
};

export function downloadHttpBytes(
  url: string,
  timeoutMs = 60_000,
  headers: Record<string, string> = {},
  redirects = 0,
): Promise<HttpDownload> {
  if (redirects > 4) return Promise.reject(new Error("HTTP download exceeded redirect limit."));

  const parsed = new URL(url);
  const client = parsed.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const request = client.get(parsed, { headers }, (response) => {
      const status = response.statusCode ?? 0;
      const location = response.headers.location;
      if (status >= 300 && status < 400 && location) {
        response.resume();
        const redirectUrl = new URL(location, parsed);
        resolve(downloadHttpBytes(
          redirectUrl.toString(),
          timeoutMs,
          redirectUrl.origin === parsed.origin ? headers : {},
          redirects + 1,
        ));
        return;
      }

      const chunks: Buffer[] = [];
      response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      response.on("end", () => {
        const body = Buffer.concat(chunks);
        if (status < 200 || status >= 300) {
          reject(new Error(`HTTP download failed (${status}): ${body.toString("utf8").slice(0, 300)}`));
          return;
        }
        const bytes = new ArrayBuffer(body.byteLength);
        new Uint8Array(bytes).set(body);
        resolve({
          bytes,
          contentType: String(response.headers["content-type"] || "application/octet-stream").split(";")[0]!.trim(),
        });
      });
    });
    request.setTimeout(timeoutMs, () => request.destroy(new Error("HTTP download timed out.")));
    request.on("error", reject);
  });
}
