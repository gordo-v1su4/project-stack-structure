/** One transport owns playback; its master audio and video buffers form one group. */
export class MediaPlaybackOwnership {
  private groups = new Map<object, { elements: Set<EventTarget>; pause: () => void }>();
  private active: object | null = null;

  register(owner: object, elements: EventTarget[], pause: () => void) {
    this.groups.set(owner, { elements: new Set(elements), pause });
    return () => {
      this.groups.delete(owner);
      if (this.active === owner) this.active = null;
    };
  }

  claim(element: EventTarget, media: Iterable<HTMLMediaElement>) {
    const owner = [...this.groups].find(([, group]) => group.elements.has(element))?.[0] ?? element;
    const changed = this.active !== owner;
    this.active = owner;
    for (const [key, group] of this.groups) if (key !== owner) group.pause();
    const allowed = this.groups.get(owner)?.elements;
    for (const other of media) if (other !== element && !allowed?.has(other)) other.pause();
    return changed;
  }

  pauseAll(media: Iterable<HTMLMediaElement>) {
    this.active = null;
    for (const group of this.groups.values()) group.pause();
    for (const element of media) element.pause();
  }
}

const ownership = new MediaPlaybackOwnership();
let users = 0;
let dispose: (() => void) | null = null;

/** Capture native controls too, including players outside the main monitor. */
export function registerMediaPlaybackGroup(owner: object, elements: HTMLMediaElement[], pause: () => void) {
  const unregister = ownership.register(owner, elements, pause);
  if (++users === 1) {
    const media = () => document.querySelectorAll<HTMLMediaElement>("video, audio");
    const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel("stack-media-playback");
    const onPlay = (event: Event) => {
      if (event.target instanceof HTMLMediaElement && !event.target.paused && ownership.claim(event.target, media())) {
        channel?.postMessage("claim");
      }
    };
    const onMessage = (event: MessageEvent) => {
      if (event.data === "claim") ownership.pauseAll(media());
    };
    document.addEventListener("play", onPlay, true);
    channel?.addEventListener("message", onMessage);
    dispose = () => {
      document.removeEventListener("play", onPlay, true);
      channel?.close();
    };
  }
  return () => {
    unregister();
    if (--users === 0) { dispose?.(); dispose = null; }
  };
}
