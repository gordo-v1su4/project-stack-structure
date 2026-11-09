import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { h3StillDigest, h3StillNativePreparation } from "./h3StillProfile";

const MAX_BYTES = 32 * 1024 * 1024;
const HASH = /^[a-f0-9]{64}$/;
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const require = createRequire(import.meta.url);

function checkPng(bytes: Buffer, width: number, height: number) {
  if (bytes.length < 45 || bytes.length > MAX_BYTES || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    || bytes.readUInt32BE(8) !== 13 || bytes.toString("ascii", 12, 16) !== "IHDR"
    || bytes.readUInt32BE(16) !== width || bytes.readUInt32BE(20) !== height || bytes[24] !== 8 || ![2, 6].includes(bytes[25])) {
    throw new Error("Still preparation requires one bounded 8-bit RGB or opaque RGBA PNG at the exact dimensions.");
  }
  let offset = 8, ended = false;
  while (offset + 12 <= bytes.length) {
    const size = bytes.readUInt32BE(offset), kind = bytes.toString("ascii", offset + 4, offset + 8);
    if (size > bytes.length - offset - 12 || kind === "acTL") throw new Error("Animated or truncated PNG is unsupported.");
    offset += size + 12;
    if (kind === "IEND") { ended = true; break; }
  }
  if (!ended || offset !== bytes.length) throw new Error("Still preparation requires one complete PNG without trailing data.");
}

// Fixed bytes-only worker. A separate process makes the wall deadline include
// libuv queue wait; kill/reap completes before the caller can release resources.
const WORKER = String.raw`
const sharp = require(process.argv[1]);
const {createHash} = require('node:crypto');
const chunks=[];let size=0;
const sha=b=>createHash('sha256').update(b).digest('hex');
process.stdin.on('data',b=>{size+=b.length;if(size>33554432)process.exit(2);chunks.push(b)});
process.stdin.on('end',async()=>{try{
 const input=Buffer.concat(chunks);
 const options={ignoreIcc:true,autoOrient:false,limitInputPixels:2048*1152,failOn:'warning'};
 const metadata=await sharp(input,options).timeout({seconds:30}).metadata();
 if(metadata.format!=='png'||metadata.width!==2048||metadata.height!==1152||metadata.pages&&metadata.pages!==1||metadata.icc||metadata.orientation&&metadata.orientation!==1)throw Error();
 const decoded=await sharp(input,options).timeout({seconds:30}).raw().toBuffer({resolveWithObject:true});
 if(decoded.info.width!==2048||decoded.info.height!==1152||![3,4].includes(decoded.info.channels))throw Error();
 if(decoded.info.channels===4)for(let i=3;i<decoded.data.length;i+=4)if(decoded.data[i]!==255)throw Error();
 const png=await sharp(decoded.data,{raw:{width:2048,height:1152,channels:decoded.info.channels}})
  .timeout({seconds:30}).removeAlpha().resize(1344,756,{fit:'fill',kernel:'lanczos3'})
  .extend({top:6,bottom:6,left:0,right:0,background:{r:0,g:0,b:0}})
  .png({compressionLevel:9,adaptiveFiltering:false,palette:false,force:true}).toBuffer();
 if(png.length>33554432)throw Error();
 const native=await sharp(png,{ignoreIcc:true,autoOrient:false,limitInputPixels:1344*768,failOn:'warning'})
  .timeout({seconds:30}).removeAlpha().raw().toBuffer({resolveWithObject:true});
 if(native.info.width!==1344||native.info.height!==768||native.info.channels!==3)throw Error();
 const bgr=Buffer.alloc(native.data.length);
 for(let i=0;i<bgr.length;i+=3){bgr[i]=native.data[i+2];bgr[i+1]=native.data[i+1];bgr[i+2]=native.data[i]}
 process.stdout.write(JSON.stringify({png:png.toString('base64'),pngSha256:sha(png),decodedPixelSha256:sha(bgr),
  nativeFrameSha256:createHash('sha256').update('(768, 1344, 3)').update(bgr).digest('hex'),sharp:sharp.versions.sharp,vips:sharp.versions.vips}));
 }catch{process.exitCode=2}});
`;

function execute(master: Buffer, timeoutMs: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["-e", WORKER, require.resolve("sharp")], { stdio: ["pipe", "pipe", "ignore"], windowsHide: true });
    const chunks: Buffer[] = []; let size = 0, failure: Error | undefined;
    const stop = (message: string) => { failure ??= new Error(message); child.kill("SIGKILL"); };
    const timer = setTimeout(() => stop("Still image preparation exceeded its wall deadline."), timeoutMs);
    child.on("error", () => { failure ??= new Error("Still image preparation worker could not start."); });
    child.stdin.on("error", () => { failure ??= new Error("Still image preparation worker input failed."); });
    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 48 * 1024 * 1024) stop("Still image preparation worker output exceeded its bound.");
      else if (!failure) chunks.push(chunk);
    });
    child.on("close", code => {
      clearTimeout(timer);
      if (failure || code !== 0) reject(failure ?? new Error("Still image preparation rejected the master PNG."));
      else resolve(Buffer.concat(chunks));
    });
    child.stdin.end(master);
  });
}

/** Deterministic local derivative only. The original master bytes are never re-encoded. */
export async function prepareH3StillImage(masterPng: Uint8Array, expectedMasterSha256: string, options: { timeoutMs?: number } = {}) {
  const timeoutMs = options.timeoutMs ?? 30_000;
  if (!(masterPng instanceof Uint8Array) || masterPng.byteLength > MAX_BYTES || !HASH.test(expectedMasterSha256)
    || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) throw new Error("Invalid still image preparation input.");
  const master = Buffer.from(masterPng);
  if (digest(master) !== expectedMasterSha256) throw new Error("Master PNG bytes changed.");
  checkPng(master, 2048, 1152);
  const result = JSON.parse((await execute(master, timeoutMs)).toString("utf8")) as Record<string, unknown>;
  if (typeof result.png !== "string" || typeof result.pngSha256 !== "string" || !HASH.test(result.pngSha256)
    || typeof result.decodedPixelSha256 !== "string" || !HASH.test(result.decodedPixelSha256)
    || typeof result.nativeFrameSha256 !== "string" || !HASH.test(result.nativeFrameSha256)
    || typeof result.sharp !== "string" || typeof result.vips !== "string" || result.sharp.length > 100 || result.vips.length > 100) throw new Error("Still image preparation worker returned invalid proof.");
  const bytes = Buffer.from(result.png, "base64");
  checkPng(bytes, 1344, 768);
  if (digest(bytes) !== result.pngSha256) throw new Error("Prepared PNG bytes differ from their proof.");
  const contract = h3StillNativePreparation(expectedMasterSha256);
  const body = { version: 1 as const, contractSha256: contract.sha256, geometry: contract.body,
    implementation: { version: "sharp-lanczos3-bgr-v1", sharp: result.sharp, vips: result.vips },
    nativePngSha256: result.pngSha256, decodedPixelSha256: result.decodedPixelSha256,
    nativeFrameSha256: result.nativeFrameSha256, nativeByteCount: bytes.length };
  return { master: { bytes: master, pngSha256: expectedMasterSha256, byteCount: master.length, width: 2048 as const, height: 1152 as const },
    native: { bytes, pngSha256: result.pngSha256, byteCount: bytes.length, width: 1344 as const, height: 768 as const,
      decodedPixelSha256: result.decodedPixelSha256, nativeFrameSha256: result.nativeFrameSha256 },
    preparation: { body, sha256: h3StillDigest(body) } };
}
