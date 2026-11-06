import { buildSwarmComfyDirectUrl } from "@/components/studio/localGeneration";

const HANDSHAKE_TIMEOUT_MS = 10_000;
const MAX_STATUS_BYTES = 64 * 1024;

/** This error is only raised before POST /prompt; no provider work was submitted. */
export class SwarmComfyClientUnavailable extends Error {}

type ClientSocket = Pick<WebSocket, "readyState" | "addEventListener" | "removeEventListener" | "close">;

export interface SwarmComfyClient {
  readonly clientId: string;
  assertOpen(): void;
  close(): void;
}

/** Register with Swarm's managed direct client route, using its default single backend.
 * Do not supply comfy_domulti cookies: general-queue virtual IDs cannot be polled
 * or reconciled using the real Comfy prompt IDs used by our durable jobs.
 */
export async function openSwarmComfyClient(baseUrl: string, options: {
  timeoutMs?: number;
  createSocket?: (url: string) => ClientSocket;
} = {}): Promise<SwarmComfyClient> {
  const url = new URL(buildSwarmComfyDirectUrl(baseUrl, "ws"));
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  const timeoutMs = options.timeoutMs ?? HANDSHAKE_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > HANDSHAKE_TIMEOUT_MS) {
    throw new SwarmComfyClientUnavailable("Invalid SwarmUI client registration timeout.");
  }
  let socket: ClientSocket;
  try { socket = (options.createSocket ?? (address => new WebSocket(address)))(url.href); }
  catch { throw new SwarmComfyClientUnavailable("SwarmUI client registration could not connect; no prompt was submitted."); }

  return await new Promise<SwarmComfyClient>((resolve, reject) => {
    let settled = false, disconnected = false, closed = false;
    const dispose = () => {
      if (closed) return;
      closed = true;
      clearTimeout(timer);
      socket.removeEventListener("message", onMessage);
      socket.removeEventListener("error", onError);
      socket.removeEventListener("close", onClose);
      try { socket.close(1000, "H3 submission registration complete"); } catch { /* Cleanup must not hide a durable provider acknowledgement. */ }
    };
    const fail = (message: string) => {
      disconnected = true;
      if (settled) return;
      settled = true;
      dispose();
      reject(new SwarmComfyClientUnavailable(message));
    };
    const onError = () => fail("SwarmUI client registration disconnected; no prompt was submitted.");
    const onClose = () => fail("SwarmUI client registration closed; no prompt was submitted.");
    const onMessage = (event: Event) => {
      const data: unknown = (event as MessageEvent).data;
      // Binary previews and unrelated/malformed messages are never registration.
      if (typeof data !== "string" || data.length > MAX_STATUS_BYTES) return;
      let message: { type?: unknown; data?: { sid?: unknown } } | null;
      try { message = JSON.parse(data); } catch { return; }
      const sid = message?.type === "status" ? message.data?.sid : undefined;
      if (typeof sid !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(sid)) return;
      if (socket.readyState !== 1 || disconnected) { onClose(); return; }
      settled = true;
      clearTimeout(timer);
      socket.removeEventListener("message", onMessage);
      resolve({
        clientId: sid,
        assertOpen() {
          if (closed || disconnected || socket.readyState !== 1) {
            throw new SwarmComfyClientUnavailable("SwarmUI client disconnected before submission; no prompt was submitted.");
          }
        },
        close: dispose,
      });
    };
    const timer = setTimeout(() => fail("SwarmUI client registration timed out; no prompt was submitted."), timeoutMs);
    socket.addEventListener("message", onMessage);
    socket.addEventListener("error", onError);
    socket.addEventListener("close", onClose);
  });
}
