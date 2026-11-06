/** In-memory EventTarget only: never opens a network connection. */
export class FakeSwarmSocket extends EventTarget {
  readyState = 0;
  closeCalls = 0;
  throwOnClose = false;

  register(sid = "registered-swarmed-client") {
    this.readyState = 1;
    this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({ type: "status", data: { sid } }) }));
  }

  message(data: unknown) {
    this.dispatchEvent(new MessageEvent("message", { data }));
  }

  disconnect() {
    this.readyState = 3;
    this.dispatchEvent(new Event("close"));
  }

  error() { this.dispatchEvent(new Event("error")); }

  close() {
    this.closeCalls++;
    this.readyState = 3;
    if (this.throwOnClose) throw new Error("Synthetic cleanup failure");
  }
}
