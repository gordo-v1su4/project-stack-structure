import path from "node:path";
import { writeFile } from "node:fs/promises";
import type { BuildExtension } from "@trigger.dev/core/v3/build";
import { TRIGGER_CONTROLLER_VERSION } from "./scripts/trigger-controller-patch-core";
import { createWorkerJavaScriptManifest, WORKER_JAVASCRIPT_MANIFEST } from "./scripts/verify-trigger-worker-javascript";

/** Only this application's managed image; runs after the complete /app COPY. */
export function controllerLogContainment(): BuildExtension {
  return {
    name: "stack-controller-log-containment",
    async onBuildComplete(context, manifest) {
      if (context.target === "dev") return;
      if (manifest.cliPackageVersion !== TRIGGER_CONTROLLER_VERSION || !manifest.runControllerEntryPoint) {
        throw new Error("Trigger controller containment requires the reviewed managed 4.5.16 CLI.");
      }
      const controller = path.relative(manifest.outputPath, manifest.runControllerEntryPoint).replaceAll("\\", "/");
      if (!/^[a-zA-Z0-9_./@-]+$/.test(controller) || controller.startsWith("/")
        || controller.split("/").includes("..") || !controller.endsWith("/managed-run-controller.mjs")) {
        throw new Error("Trigger controller entry point is outside the application image build directory.");
      }
      // additionalFiles uses this same output directory. The manifest travels in
      // the complete /app COPY and detects even syntactically valid byte damage.
      const cleanBundle = await createWorkerJavaScriptManifest(manifest.outputPath);
      await writeFile(path.join(manifest.outputPath, WORKER_JAVASCRIPT_MANIFEST), JSON.stringify(cleanBundle));
      context.addLayer({ id: "stack-controller-log-containment",
        commands: [`bun scripts/patch-trigger-controller.ts --file '${controller}'`,
          `bun scripts/verify-trigger-worker-javascript.ts --root /app --controller '${controller}'`] });
    },
  };
}
