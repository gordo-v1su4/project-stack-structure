import assert from "node:assert/strict";
import { createReadStream, createWriteStream } from "node:fs";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { createGunzip, createGzip } from "node:zlib";

// App VM's held containerd runtime fails to unpack compressed OCI imports.
// Preserve the exact config and diff IDs in a legacy Docker archive instead.
const [input, output, revision] = process.argv.slice(2);
assert(input && output && /^[a-f0-9]{40}$/.test(revision ?? ""), "Expected input archive, output gzip and committed revision");
const destination = resolve(output);
await mkdir(dirname(destination), { recursive: true });
const stage = await mkdtemp(join(dirname(destination), ".image-package-"));
async function hash(path) {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest("hex");
}
try {
  execFileSync("tar", ["-xf", resolve(input), "-C", stage]);
  const manifests = JSON.parse(await readFile(join(stage, "manifest.json"), "utf8"));
  assert(manifests.length === 1, "Expected exactly one saved image");
  const manifest = manifests[0];
  const sourcePath = name => {
    assert(/^(?:blobs\/sha256\/)?[a-f0-9]{64}(?:\.json)?$/.test(name), "Unexpected saved image path");
    return join(stage, name);
  };
  const configPath = sourcePath(manifest.Config);
  const config = JSON.parse(await readFile(configPath, "utf8"));
  assert(config.os === "linux" && config.architecture === "amd64", "Wrong image platform");
  assert(config.config.Labels["org.opencontainers.image.revision"] === revision, "Wrong image revision");
  assert(config.rootfs.diff_ids.length === manifest.Layers.length, "Layer count changed");
  assert(await hash(configPath) === manifest.Config.split("/").at(-1).replace(/\.json$/, ""), "Config digest mismatch");
  const layers = [];
  for (const [index, name] of manifest.Layers.entries()) {
    const source = sourcePath(name);
    assert(await hash(source) === name.split("/").at(-1), "Saved layer digest mismatch");
    const layer = `layer-${index}.tar`;
    const target = join(stage, layer);
    const magic = (await readFile(source)).subarray(0, 2);
    if (magic[0] === 31 && magic[1] === 139) {
      await pipeline(createReadStream(source), createGunzip(), createWriteStream(target));
    } else await copyFile(source, target);
    assert("sha256:" + await hash(target) === config.rootfs.diff_ids[index], "Uncompressed layer digest mismatch");
    execFileSync("tar", ["-tf", target], { stdio: "ignore" });
    layers.push(layer);
  }
  await copyFile(configPath, join(stage, "config.json"));
  await writeFile(join(stage, "manifest.json"), JSON.stringify([{
    Config: "config.json", RepoTags: [`project-stack-structure-web:${revision}`], Layers: layers,
  }]));
  const tar = join(stage, "image.tar");
  execFileSync("tar", ["-cf", tar, "-C", stage, "manifest.json", "config.json", ...layers]);
  await pipeline(createReadStream(tar), createGzip(), createWriteStream(destination));
  console.log(JSON.stringify({ revision, verifiedLayers: layers.length, archive: "legacy Docker, uncompressed layers" }));
} finally {
  assert(stage.startsWith(join(dirname(destination), ".image-package-")), "Unexpected cleanup directory");
  await rm(stage, { recursive: true, force: true });
}
