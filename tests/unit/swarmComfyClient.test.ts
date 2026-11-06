import { describe, expect, test } from "bun:test";
import { openSwarmComfyClient, SwarmComfyClientUnavailable } from "@/lib/swarmComfyClient";
import { FakeSwarmSocket } from "../helpers/fakeSwarmSocket";

describe("managed Swarm direct client registration", () => {
  test("waits for the registered status SID on the managed URL, never an open event or unrelated message", async () => {
    const socket = new FakeSwarmSocket();
    let connected = false;
    const registration = openSwarmComfyClient("https://swarm.test:7861/prefix", { createSocket: url => {
      expect(url).toBe("wss://swarm.test:7861/prefix/ComfyBackendDirect/ws");
      return socket;
    } }).then(client => { connected = true; return client; });
    socket.readyState = 1;
    socket.dispatchEvent(new Event("open"));
    for (const message of [new Uint8Array([1]), "not-json", "null", JSON.stringify({ type: "progress", data: { sid: "wrong" } }),
      JSON.stringify({ type: "status", data: { sid: "" } }), JSON.stringify({ type: "status", data: { sid: "bad client" } }),
      JSON.stringify({ type: "status", data: { sid: "x".repeat(129) } }), "x".repeat(65_537)]) socket.message(message);
    await Promise.resolve();
    expect(connected).toBe(false);
    socket.register("server-registered-abc123");
    const client = await registration;
    expect(client.clientId).toBe("server-registered-abc123");
    client.assertOpen();
    expect(socket.closeCalls).toBe(0);
    client.close(); client.close();
    expect(socket.closeCalls).toBe(1);
    expect(() => client.assertOpen()).toThrow("before submission");
  });

  test("bounded handshake timeout closes the socket without a prompt submission", async () => {
    const socket = new FakeSwarmSocket();
    await expect(openSwarmComfyClient("http://swarm.test:7861", { timeoutMs: 1, createSocket: () => socket })).rejects.toThrow("timed out");
    expect(socket.closeCalls).toBe(1);
  });

  test("connection creation failure and invalid time bounds are known no-submit failures", async () => {
    await expect(openSwarmComfyClient("http://swarm.test", { createSocket: () => { throw Error("private transport details"); } })).rejects.toThrow("no prompt was submitted");
    let creations = 0;
    for (const timeoutMs of [0, -1, Number.NaN, 10_001]) {
      await expect(openSwarmComfyClient("http://swarm.test", { timeoutMs, createSocket: () => { creations++; return new FakeSwarmSocket(); } })).rejects.toThrow("timeout");
    }
    expect(creations).toBe(0);
  });

  test("close/error before registration rejects and cleans up; a SID from a closed socket is never usable", async () => {
    for (const kind of ["close", "error", "closed-status"]) {
      const socket = new FakeSwarmSocket();
      const registered = openSwarmComfyClient("http://swarm.test", { createSocket: () => socket });
      if (kind === "close") socket.disconnect();
      else if (kind === "error") socket.error();
      else { socket.readyState = 3; socket.message(JSON.stringify({ type: "status", data: { sid: "already-closed" } })); }
      await expect(registered).rejects.toBeInstanceOf(SwarmComfyClientUnavailable);
      expect(socket.closeCalls).toBe(1);
    }
  });

  test("a late close/error prevents submission, while cleanup cannot mask a durable ACK", async () => {
    for (const disconnect of ["close", "error"]) {
      const socket = new FakeSwarmSocket();
      const ready = openSwarmComfyClient("http://swarm.test", { createSocket: () => socket });
      socket.register();
      const client = await ready;
      if (disconnect === "close") socket.disconnect(); else socket.error();
      expect(() => client.assertOpen()).toThrow("before submission");
      socket.throwOnClose = true;
      expect(() => client.close()).not.toThrow();
      expect(socket.closeCalls).toBe(1);
    }
  });
});
