// Executable wrapper only. Config and tests import the pure core, never this file.
import { patchTriggerControllerFile } from "./trigger-controller-patch-core";

async function main() {
  if (process.argv.length !== 4 || process.argv[2] !== "--file") {
    throw new Error("Usage: bun scripts/patch-trigger-controller.ts --file CONTROLLER");
  }
  await patchTriggerControllerFile(process.argv[3]);
  console.log("Trigger controller attempt logging: metadata allowlist verified.");
}

void main().catch(error => {
  console.error(error instanceof Error ? error.message : "Trigger controller containment failed.");
  process.exitCode = 1;
});
