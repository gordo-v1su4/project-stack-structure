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
  console.log(JSON.stringify({ pinnedCliConfigLoaded: true, containmentExtensionCount: count }));
} catch (error) {
  console.error(JSON.stringify({ pinnedCliConfigLoaded: false, errorType: error?.name ?? "Error" }));
  process.exitCode = 1;
}
