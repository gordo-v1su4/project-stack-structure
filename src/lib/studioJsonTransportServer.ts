import { gunzip, gzip } from "node:zlib";
import { promisify } from "node:util";
import { NextResponse } from "next/server";
import { STUDIO_JSON_COMPRESSION_THRESHOLD, STUDIO_JSON_MAX_EXPANDED_BYTES, STUDIO_JSON_MAX_WIRE_BYTES } from "./studioJsonTransport";

const gunzipAsync = promisify(gunzip);
const gzipAsync = promisify(gzip);

export class StudioJsonBodyError extends Error {
  constructor(message: string, readonly status: 400 | 413) { super(message); }
}

/** Call only after session authentication. Both streamed input and inflation are bounded. */
export async function readStudioJsonBody(request: Request): Promise<unknown> {
  const encoding = request.headers.get("content-encoding")?.trim().toLowerCase() ?? "identity";
  if (encoding !== "identity" && encoding !== "gzip") throw new StudioJsonBodyError("Unsupported project body encoding.", 400);
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > STUDIO_JSON_MAX_WIRE_BYTES)) {
    throw new StudioJsonBodyError("Project request exceeds the 4 MB transport limit.", 413);
  }
  if (!request.body) throw new StudioJsonBodyError("Project JSON body is required.", 400);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > STUDIO_JSON_MAX_WIRE_BYTES) {
        await reader.cancel();
        throw new StudioJsonBodyError("Project request exceeds the 4 MB transport limit.", 413);
      }
      chunks.push(next.value);
    }
  } catch (error) {
    if (error instanceof StudioJsonBodyError) throw error;
    throw new StudioJsonBodyError("Project request could not be read.", 400);
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let expanded: Uint8Array = bytes;
  if (encoding === "gzip") {
    try { expanded = await gunzipAsync(bytes, { maxOutputLength: STUDIO_JSON_MAX_EXPANDED_BYTES }); }
    catch (error) {
      if ((error as { code?: string }).code === "ERR_BUFFER_TOO_LARGE") throw new StudioJsonBodyError("Expanded project exceeds the 32 MiB save limit.", 413);
      throw new StudioJsonBodyError("Compressed project JSON is invalid.", 400);
    }
  }
  if (expanded.byteLength > STUDIO_JSON_MAX_EXPANDED_BYTES) throw new StudioJsonBodyError("Expanded project exceeds the 32 MiB save limit.", 413);
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(expanded)); }
  catch { throw new StudioJsonBodyError("Project JSON is invalid.", 400); }
}

export function studioJsonBodyErrorResponse(error: unknown): Response | null {
  return error instanceof StudioJsonBodyError ? Response.json({ success: false, error: error.message }, { status: error.status }) : null;
}

/** Negotiate compressed responses too: saved projects can exceed the hosting response cap. */
export async function studioJsonResponse(request: Request | undefined, value: unknown, status = 200): Promise<NextResponse> {
  const json = JSON.stringify(value);
  const bytes = new TextEncoder().encode(json);
  if (bytes.byteLength > STUDIO_JSON_MAX_EXPANDED_BYTES) return NextResponse.json({ success: false, error: "Expanded project exceeds the 32 MiB load limit." }, { status: 413 });
  if (request?.headers.get("x-studio-json-transport") === "gzip" && bytes.byteLength >= STUDIO_JSON_COMPRESSION_THRESHOLD) {
    const compressed = await gzipAsync(bytes);
    if (compressed.byteLength > STUDIO_JSON_MAX_WIRE_BYTES) return NextResponse.json({ success: false, error: "Compressed project exceeds the 4 MB transport limit." }, { status: 413 });
    return new NextResponse(new Uint8Array(compressed), { status, headers: {
      "content-type": "application/json", "content-encoding": "gzip", "cache-control": "private, no-store", "vary": "x-studio-json-transport",
    } });
  }
  if (bytes.byteLength > STUDIO_JSON_MAX_WIRE_BYTES) return NextResponse.json({ success: false, error: "Project requires gzip transport. Update the app and retry." }, { status: 413 });
  return new NextResponse(json, { status, headers: { "content-type": "application/json", "cache-control": "private, no-store", "vary": "x-studio-json-transport" } });
}
