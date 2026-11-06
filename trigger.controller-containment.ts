import path from "node:path";
import type { BuildExtension } from "@trigger.dev/core/v3/build";
import { TRIGGER_CONTROLLER_VERSION } from "./scripts/patch-trigger-controller";

/** Only this application's managed image; runs after the complete /app COPY. */
export function controllerLogContainment(): BuildExtension {
  return {
    name: "stack-controller-log-containment",
    onBuildComplete(context, manifest) {
      if (context.target === "dev") return;
      if (manifest.cliPackageVersion !== TRIGGER_CONTROLLER_VERSION || !manifest.runControllerEntryPoint) {
        throw new Error("Trigger controller containment requires the reviewed managed 4.5.16 CLI.");
      }
      const controller = path.relative(manifest.outputPath, manifest.runControllerEntryPoint).replaceAll("\\", "/");
      if (!/^[a-zA-Z0-9_./@-]+$/.test(controller) || controller.startsWith("/")
        || controller.split("/").includes("..") || !controller.endsWith("/managed-run-controller.mjs")) {
        throw new Error("Trigger controller entry point is outside the application image build directory.");
      }
      context.addLayer({ id: "stack-controller-log-containment",
        commands: [`bun scripts/patch-trigger-controller.ts --file '${controller}'`] });
    },
  };
}
