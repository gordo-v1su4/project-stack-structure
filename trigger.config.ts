import { defineConfig } from "@trigger.dev/sdk";
import { additionalFiles, ffmpeg } from "@trigger.dev/build/extensions/core";

export default defineConfig({
  // The production project remains the default. Temporary self-hosted
  // rehearsals can point this config at their isolated local project without
  // changing the deployed/Vercel project reference.
  project: process.env.TRIGGER_PROJECT_REF || "proj_wlrcsfnmovzmdwzojzfe",
  // Bun is the project runtime on both the temporary Windows/WSL staging path
  // and the eventual Linux deployment. Keeping this explicit prevents the
  // Trigger build from silently falling back to Node.
  runtime: "bun",
  logLevel: "log",
  // The max compute seconds a task is allowed to run. If the task run exceeds this duration, it will be stopped.
  // You can override this on an individual task.
  // See https://trigger.dev/docs/runs/max-duration
  maxDuration: 3600,
  retries: {
    enabledInDev: true,
    default: {
      maxAttempts: 3,
      minTimeoutInMs: 1000,
      maxTimeoutInMs: 10000,
      factor: 2,
      randomize: true,
    },
  },
  build: {
    extensions: [
      ffmpeg({ version: "7" }),
      // The higgsfield CLI is spawned at runtime (not imported), so the
      // bundler never traces it — ship the self-contained package explicitly.
      additionalFiles({ files: ["node_modules/@higgsfield/cli/**"] }),
    ],
  },
  dirs: ["./src/trigger"],
});
