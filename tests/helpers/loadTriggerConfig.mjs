// Executes the real pinned CLI's c12/jiti loader without auth, API calls or a deploy.
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

let outputPath;
try {
  const cli = path.resolve(process.argv[2]), cwd = path.resolve(process.argv[3]);
  const metadata = JSON.parse(await readFile(path.join(cli, "package.json"), "utf8"));
  if (metadata.version !== "4.5.16") throw new Error("Wrong pinned CLI version");
  const { loadConfig } = await import(pathToFileURL(path.join(cli, "dist/esm/config.js")).href);
  const config = await loadConfig({ cwd, warn: false });
  const count = config.build.extensions.filter(extension => extension.name === "stack-controller-log-containment").length;
  if (count !== 1) throw new Error("Missing containment extension");
  const layers = [];
  outputPath = await mkdtemp(path.join(tmpdir(), "trigger-config-loader-"));
  await writeFile(path.join(outputPath, "worker.mjs"), "export const worker = true;\n");
  await config.build.extensions.find(extension => extension.name === "stack-controller-log-containment").onBuildComplete(
    { target: "deploy", addLayer: layer => layers.push(layer) },
    { cliPackageVersion: metadata.version, outputPath, runControllerEntryPoint: path.join(outputPath, "tmp/cli/managed-run-controller.mjs") });
  if (layers.length !== 1 || layers[0].commands?.length !== 2
    || layers[0].commands[0] !== "bun scripts/patch-trigger-controller.ts --file 'tmp/cli/managed-run-controller.mjs'"
    || layers[0].commands[1] !== "bun scripts/verify-trigger-worker-javascript.ts --root /app --controller 'tmp/cli/managed-run-controller.mjs'") {
    throw new Error("Wrong containment build hook");
  }
  const clean = JSON.parse(await readFile(path.join(outputPath, "stack-worker-javascript.sha256.json"), "utf8"));
  if (clean.version !== 1 || clean.files.length !== 1 || clean.files[0].file !== "worker.mjs") throw new Error("Missing clean bundle manifest");
  const builder = await readFile(path.join(cli, "dist/esm/deploy/buildImage.js"), "utf8");
  const template = builder.slice(builder.indexOf("async function generateBunContainerfile"), builder.indexOf("async function generateNodeContainerfile"));
  const sourceCopy = template.indexOf("COPY --chown=bun:bun . ."), commands = template.indexOf("${postInstallCommands}"), startup = template.indexOf("ENTRYPOINT");
  if (!(sourceCopy >= 0 && commands > sourceCopy && startup > commands)) throw new Error("Unreviewed CLI Dockerfile build ordering");
  console.log(JSON.stringify({ pinnedCliConfigLoaded: true, containmentExtensionCount: count,
    postCopyHookCount: layers.length, pinnedCliTemplateCopiesBeforePatch: true, pinnedCliTemplatePatchesBeforeStartup: true }));
} catch (error) {
  console.error(JSON.stringify({ pinnedCliConfigLoaded: false, errorType: error?.name ?? "Error" }));
  process.exitCode = 1;
} finally {
  if (outputPath) await rm(outputPath, { recursive: true, force: true });
}
