// Executes the real pinned CLI's c12/jiti loader without auth, API calls or a deploy.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

try {
  const cli = path.resolve(process.argv[2]), cwd = path.resolve(process.argv[3]);
  const metadata = JSON.parse(await readFile(path.join(cli, "package.json"), "utf8"));
  if (metadata.version !== "4.5.16") throw new Error("Wrong pinned CLI version");
  const { loadConfig } = await import(pathToFileURL(path.join(cli, "dist/esm/config.js")).href);
  const config = await loadConfig({ cwd, warn: false });
  const count = config.build.extensions.filter(extension => extension.name === "stack-controller-log-containment").length;
  if (count !== 1) throw new Error("Missing containment extension");
  const layers = [];
  await config.build.extensions.find(extension => extension.name === "stack-controller-log-containment").onBuildComplete(
    { target: "deploy", addLayer: layer => layers.push(layer) },
    { cliPackageVersion: metadata.version, outputPath: "/build", runControllerEntryPoint: "/build/tmp/cli/managed-run-controller.mjs" });
  if (layers.length !== 1 || layers[0].commands?.[0] !== "bun scripts/patch-trigger-controller.ts --file 'tmp/cli/managed-run-controller.mjs'") {
    throw new Error("Wrong containment build hook");
  }
  const builder = await readFile(path.join(cli, "dist/esm/deploy/buildImage.js"), "utf8");
  const template = builder.slice(builder.indexOf("async function generateBunContainerfile"), builder.indexOf("async function generateNodeContainerfile"));
  const sourceCopy = template.indexOf("COPY --chown=bun:bun . ."), commands = template.indexOf("${postInstallCommands}"), startup = template.indexOf("ENTRYPOINT");
  if (!(sourceCopy >= 0 && commands > sourceCopy && startup > commands)) throw new Error("Unreviewed CLI Dockerfile build ordering");
  console.log(JSON.stringify({ pinnedCliConfigLoaded: true, containmentExtensionCount: count,
    postCopyHookCount: layers.length, pinnedCliTemplateCopiesBeforePatch: true, pinnedCliTemplatePatchesBeforeStartup: true }));
} catch (error) {
  console.error(JSON.stringify({ pinnedCliConfigLoaded: false, errorType: error?.name ?? "Error" }));
  process.exitCode = 1;
}
