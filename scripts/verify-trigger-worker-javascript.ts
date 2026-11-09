import { createHash } from "node:crypto";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { isReviewedPatchedControllerSha256 } from "./trigger-controller-patch-core";

export const WORKER_JAVASCRIPT_MANIFEST = "stack-worker-javascript.sha256.json";
const MAX_FILES = 512, MAX_FILE_BYTES = 128 * 1024 * 1024, MAX_TOTAL_BYTES = 512 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 128 * 1024, TOTAL_CHECK_MS = 120_000, FILE_CHECK_MS = 20_000;
type WorkerFile = { file: string; bytes: number; sha256: string };
export type WorkerJavaScriptManifest = { version: 1; files: WorkerFile[] };
const hashPattern = /^[a-f0-9]{64}$/;
const safeName = (name: string) => /^[a-zA-Z0-9_-][a-zA-Z0-9_.-]*\.mjs$/.test(name);
const samePath = (a: string, b: string) => process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
function fail(reason: string, file?: string): never {
  // Never include Node diagnostics, source text, arbitrary filenames, paths or environment.
  throw new Error(`Packaged worker JavaScript ${reason}${file && safeName(file) ? `: ${file}` : "."}`);
}
async function canonicalRoot(root: string) {
  if (!path.isAbsolute(root) || path.resolve(root) !== root) fail("requires a canonical absolute root");
  const stat = await lstat(root);
  if (!stat.isDirectory() || stat.isSymbolicLink() || !samePath(await realpath(root), root)) fail("requires a canonical directory");
}
async function regularFile(root: string, relative: string) {
  const absolute = path.join(root, relative), stat = await lstat(absolute);
  if (!stat.isFile() || stat.isSymbolicLink() || !samePath(await realpath(absolute), absolute)) fail("contains a noncanonical file", path.basename(relative));
  if (!Number.isSafeInteger(stat.size) || stat.size < 1 || stat.size > MAX_FILE_BYTES) fail("exceeds its file bound", path.basename(relative));
  return { absolute, bytes: stat.size };
}
async function rootFiles(root: string) {
  await canonicalRoot(root);
  const entries = await readdir(root);
  if (entries.length > 4096) fail("exceeds its directory bound");
  const files = entries.filter(name => /\.mjs$/i.test(name)).sort();
  if (!files.length || files.length > MAX_FILES) fail("requires a bounded nonempty root bundle");
  if (files.some(file => !safeName(file))) fail("contains a noncanonical bundle filename");
  return files;
}
async function fingerprint(root: string, relative: string): Promise<WorkerFile> {
  const { absolute, bytes } = await regularFile(root, relative), file = path.basename(relative);
  const handle = await open(absolute, "r"), hash = createHash("sha256"), buffer = Buffer.alloc(256 * 1024);
  let read = 0;
  try {
    while (true) {
      const chunk = await handle.read(buffer, 0, buffer.length, null);
      if (!chunk.bytesRead) break;
      read += chunk.bytesRead;
      if (read > bytes || read > MAX_FILE_BYTES) fail("changed while reading", file);
      const content = buffer.subarray(0, chunk.bytesRead);
      if (content.includes(0)) fail("contains a literal NUL", file);
      hash.update(content);
    }
  } finally { await handle.close(); }
  if (read !== bytes) fail("changed while reading", file);
  return { file: relative, bytes, sha256: hash.digest("hex") };
}
/** Snapshot the clean bundler output before Docker COPY; this never imports a worker. */
export async function createWorkerJavaScriptManifest(root: string): Promise<WorkerJavaScriptManifest> {
  const files: WorkerFile[] = []; let total = 0;
  for (const name of await rootFiles(root)) {
    const file = await fingerprint(root, name); total += file.bytes;
    if (total > MAX_TOTAL_BYTES) fail("exceeds its total byte bound");
    files.push(file);
  }
  return { version: 1, files };
}
function normalizeManifest(value: unknown): WorkerJavaScriptManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("manifest is invalid");
  const record = value as Record<string, unknown>;
  if (record.version !== 1 || !Array.isArray(record.files) || !record.files.length || record.files.length > MAX_FILES) fail("manifest is invalid");
  const files: WorkerFile[] = []; let total = 0;
  for (const value of record.files) {
    if (!value || typeof value !== "object" || Array.isArray(value)) fail("manifest is invalid");
    const file = value as WorkerFile;
    if (typeof file.file !== "string" || !safeName(file.file) || !Number.isSafeInteger(file.bytes) || file.bytes < 1 || file.bytes > MAX_FILE_BYTES || !hashPattern.test(file.sha256)) fail("manifest is invalid");
    total += file.bytes; if (total > MAX_TOTAL_BYTES) fail("manifest exceeds its total byte bound");
    files.push({ file: file.file, bytes: file.bytes, sha256: file.sha256 });
  }
  if (new Set(files.map(file => file.file)).size !== files.length) fail("manifest contains duplicate files");
  return { version: 1, files: files.sort((a, b) => a.file < b.file ? -1 : a.file > b.file ? 1 : 0) };
}
function controllerPath(relative: string) {
  if (!/^[a-zA-Z0-9_./@-]+$/.test(relative) || relative.includes("\\") || relative.startsWith("/")
    || relative.split("/").some(part => !part || part === "." || part === "..") || !relative.endsWith("/managed-run-controller.mjs")) fail("controller path is invalid");
  return relative;
}
/** Test seam only changes the expected fixture hash; CLI requires an exact reviewed patch output. */
export async function verifyPackagedWorkerJavaScript(root: string, controller: string, manifest: unknown,
  expectedControllerSha256?: string) {
  const expected = normalizeManifest(manifest), actual = await createWorkerJavaScriptManifest(root);
  if (JSON.stringify(actual.files.map(file => file.file)) !== JSON.stringify(expected.files.map(file => file.file))) fail("bundle file set differs from the clean build");
  for (let i = 0; i < actual.files.length; i++) if (actual.files[i].bytes !== expected.files[i].bytes || actual.files[i].sha256 !== expected.files[i].sha256) fail("differs from the clean build", actual.files[i].file);
  const controllerFile = await fingerprint(root, controllerPath(controller));
  if (expectedControllerSha256 === undefined ? !isReviewedPatchedControllerSha256(controllerFile.sha256)
    : !hashPattern.test(expectedControllerSha256) || controllerFile.sha256 !== expectedControllerSha256) fail("controller patch checksum differs", "managed-run-controller.mjs");
  const files = [...actual.files.map(file => file.file), controller], deadline = Date.now() + TOTAL_CHECK_MS;
  // NODE_OPTIONS/NODE_PATH are deliberately absent: --check must not preload application code.
  const env = { NODE_ENV: "production" as const, PATH: process.env.PATH, ...(process.platform === "win32" ? { SystemRoot: process.env.SystemRoot } : {}) };
  for (const file of files) {
    const remaining = deadline - Date.now(); if (remaining <= 0) fail("syntax deadline expired", path.basename(file));
    const result = spawnSync("node", ["--check", path.join(root, file)], {
      cwd: root, env, stdio: "ignore", timeout: Math.min(FILE_CHECK_MS, remaining), windowsHide: true,
    });
    if (result.error || result.signal || result.status !== 0) fail("syntax check failed", path.basename(file));
  }
  return { checkedFiles: files };
}
async function main() {
  if (process.argv.length !== 6 || process.argv[2] !== "--root" || process.argv[4] !== "--controller") fail("arguments are invalid");
  const root = process.argv[3]; await canonicalRoot(root);
  const file = await regularFile(root, WORKER_JAVASCRIPT_MANIFEST);
  if (file.bytes > MAX_MANIFEST_BYTES) fail("manifest exceeds its byte bound");
  const handle = await open(file.absolute, "r"); let bytes: Buffer;
  try { bytes = Buffer.alloc(file.bytes); const read = await handle.read(bytes, 0, bytes.length, 0); if (read.bytesRead !== bytes.length) fail("manifest read is incomplete"); }
  finally { await handle.close(); }
  const result = await verifyPackagedWorkerJavaScript(root, process.argv[5], JSON.parse(bytes.toString("utf8")));
  console.log(`Trigger packaged JavaScript verified (${result.checkedFiles.length} files).`);
}
// Keep the config's CJS/jiti import path free of import.meta and top-level await.
if (process.argv[1] && path.basename(process.argv[1]) === "verify-trigger-worker-javascript.ts") {
  void main().catch(error => {
    console.error(error instanceof Error && error.message.startsWith("Packaged worker JavaScript ") ? error.message : "Packaged worker JavaScript verification failed.");
    process.exitCode = 1;
  });
}
