/** Below the hosting request/response limit, including room for headers/envelopes. */
export const STUDIO_JSON_MAX_WIRE_BYTES = 4_000_000;
export const STUDIO_JSON_MAX_EXPANDED_BYTES = 32 * 1024 * 1024;
export const STUDIO_JSON_COMPRESSION_THRESHOLD = 64 * 1024;
export const STUDIO_JSON_TRANSPORT_HEADERS = { "x-studio-json-transport": "gzip" };

/** Browser-only compression primitives; no Node modules enter the client bundle. */
export async function encodeStudioJsonRequest(value: unknown): Promise<{ headers: Record<string, string>; body: BodyInit }> {
  const json = JSON.stringify(value);
  const byteLength = new TextEncoder().encode(json).byteLength;
  if (byteLength > STUDIO_JSON_MAX_EXPANDED_BYTES) throw new Error("Project draft exceeds the 32 MiB save limit.");
  const headers: Record<string, string> = { ...STUDIO_JSON_TRANSPORT_HEADERS, "content-type": "application/json" };
  if (byteLength < STUDIO_JSON_COMPRESSION_THRESHOLD || typeof CompressionStream === "undefined") {
    if (byteLength > STUDIO_JSON_MAX_WIRE_BYTES) throw new Error("This browser cannot compress the project draft. Use a browser with CompressionStream support.");
    return { headers, body: json };
  }
  const compressed = await new Response(new Blob([json]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer();
  if (compressed.byteLength > STUDIO_JSON_MAX_WIRE_BYTES) throw new Error("Compressed project draft exceeds the 4 MB save limit.");
  return { headers: { ...headers, "content-encoding": "gzip" }, body: compressed };
}
