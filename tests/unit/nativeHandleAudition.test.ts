import { describe, expect, test } from "bun:test";
import { createNativeHandleAudition } from "@/components/studio/nativeHandleAudition";

function fixture(nativeFrames=true) {
  let nextId=0, pauses=0, plays=0;
  const frames=new Map<number,VideoFrameRequestCallback>(), animations=new Map<number,FrameRequestCallback>();
  const video={currentTime:0,pause(){pauses++;},play(){plays++;return Promise.resolve();},
    ...(nativeFrames?{
      requestVideoFrameCallback(callback:VideoFrameRequestCallback){const id=++nextId;frames.set(id,callback);return id;},
      cancelVideoFrameCallback(id:number){frames.delete(id);},
    }:{})};
  const control=createNativeHandleAudition(video,{trimStart:.75,endFrameExclusive:79,fps:24},{
    request(callback){const id=++nextId;animations.set(id,callback);return id;},cancel(id){animations.delete(id);},
  });
  function frame(mediaTime:number){
    const [id,callback]=[...frames][0];frames.delete(id);
    callback(0,{mediaTime} as VideoFrameCallbackMetadata);
  }
  return {video,control,frames,animations,frame,get pauses(){return pauses;},get plays(){return plays;}};
}

describe("native handle audition lifecycle",()=>{
  test("E30 finishes on native frame78 at3.25s rather than the later fractional target end",()=>{
    const f=fixture();f.control.play();
    expect(f.video.currentTime).toBe(.75);expect(f.plays).toBe(1);
    f.video.currentTime=77/24;f.frame(77/24);
    expect(f.pauses).toBe(0);expect(f.frames.size).toBe(1);
    f.video.currentTime=3.27;f.frame(78/24);
    expect(f.pauses).toBe(1);expect(f.video.currentTime).toBe(3.25);expect(f.frames.size).toBe(0);
  });
  test("a delayed compositor callback still clamps to the last included frame",()=>{
    const f=fixture();f.control.play();f.video.currentTime=3.370708;f.frame(80/24);
    expect(f.video.currentTime).toBe(3.25);expect(f.pauses).toBe(1);expect(f.frames.size).toBe(0);
  });
  test("browsers without frame callbacks use a cancellable animation-frame boundary",()=>{
    const f=fixture(false);f.control.play();expect(f.animations.size).toBe(1);
    const [id,callback]=[...f.animations][0];f.animations.delete(id);
    f.video.currentTime=3.26;callback(0);
    expect(f.video.currentTime).toBe(3.25);expect(f.pauses).toBe(1);expect(f.animations.size).toBe(0);
  });
  test("closing or changing a handle pauses and prevents stale callbacks or restart",()=>{
    const f=fixture();f.control.play();const stale=[...f.frames.values()][0];
    f.control.destroy();expect(f.frames.size).toBe(0);expect(f.pauses).toBe(1);
    f.video.currentTime=1.5;stale(0,{mediaTime:4} as VideoFrameCallbackMetadata);
    f.control.play();f.control.watch();f.control.check(4);
    expect(f.video.currentTime).toBe(1.5);expect(f.plays).toBe(1);expect(f.frames.size).toBe(0);
  });
  test("pausing cancels callbacks without moving the chosen frame",()=>{
    const f=fixture();f.control.play();f.video.currentTime=2;f.control.cancel();
    expect(f.frames.size).toBe(0);expect(f.video.currentTime).toBe(2);
    f.control.watch();expect(f.frames.size).toBe(1);
  });
});
