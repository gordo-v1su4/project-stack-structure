import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, realpathSync, statfsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const revision = process.argv[2];
assert(/^[a-f0-9]{40}$/.test(revision ?? ""), "Expected a full committed revision");
assert(process.env.GITHUB_REPOSITORY === "gordo-v1su4/project-stack-structure", "Wrong deployment repository");
assert(process.env.GITHUB_REF === "refs/heads/main", "Deploy only main");
const parseEnv = text => Object.fromEntries(text.split(/\r?\n/).filter(line => /^[A-Z][A-Z0-9_]*=/.test(line))
  .map(line => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]));
const config = parseEnv(readFileSync("/opt/project-stack-structure/deploy.env", "utf8"));
const runtime = parseEnv(readFileSync("/opt/project-stack-structure/private.env", "utf8"));
assert(config.DOCKHAND_URL === "http://100.105.199.93:13000" && config.DOCKHAND_ENV_ID === "3", "Unexpected Dockhand target");
assert(runtime.AUTH_URL === "https://stack.v1su4.dev" && runtime.AUTH_TRUST_HOST === "true", "Unexpected public auth origin");
for (const name of ["AUTH_GITHUB_ID", "AUTH_GITHUB_SECRET", "AUTH_SECRET", "MEDIA_GATEWAY_URL", "MEDIA_GATEWAY_TOKEN", "TRIGGER_API_URL", "TRIGGER_SECRET_KEY", "RUSTFS_ACCESS_KEY", "RUSTFS_SECRET_KEY"]) {
  assert(runtime[name] && runtime[name] !== "[SENSITIVE]", `${name} must be configured`);
}
const root = "/home/gordo/project-stack-structure-releases";
mkdirSync(root, { recursive: true });
assert(realpathSync(root) === root, "Release root must not be a symlink");
const disk = statfsSync(root);
assert(disk.bavail * disk.bsize > 8 * 1024 ** 3, "Insufficient free build space");
const release = resolve(root, revision);
mkdirSync(release, { recursive: true });
assert(realpathSync(release) === release, "Release directory must not be a symlink");
const run = (cmd, args, options = {}) => {
  const result = spawnSync(cmd, args, { stdio: "inherit", ...options });
  assert(result.status === 0, `${cmd} failed`);
  return result.stdout;
};
const archive = spawnSync("git", ["archive", revision], { maxBuffer: 128 * 1024 ** 2 });
assert(archive.status === 0, "Committed source export failed");
run("tar", ["-x", "-C", release], { input: archive.stdout, stdio: ["pipe", "inherit", "inherit"] });
const image = `project-stack-structure-web:${revision}`;
const dependencyImage = `project-stack-structure-dependencies:${revision}`;
run("docker", ["build", "--target", "dependencies", "-f", `${release}/infra/app-vm/Dockerfile`, "-t", dependencyImage, release]);
run("docker", ["run", "--rm", "--cpus=2", "--memory=6g", "-v", `${release}:/app`, "-w", "/app", dependencyImage,
  "sh", "-c", "bun install --frozen-lockfile && bun run check"]);
run("docker", ["build", "--build-arg", `APP_REVISION=${revision}`, "-f", `${release}/infra/app-vm/Dockerfile`, "-t", image, release]);

const base = config.DOCKHAND_URL;
async function api(path, method = "GET", body) {
  const response = await fetch(base + path, {
    method, headers: { "Content-Type": "application/json", Origin: base },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30_000),
  });
  assert(response.ok, `Dockhand ${method} ${path} failed (${response.status})`);
  return response.json();
}
const stack = "/api/stacks/project-stack-structure";
const composePath = stack + "/compose?env=3";
const previous = (await api(composePath)).content;
assert(previous.includes("container_name: project-stack-structure-web") && previous.includes("pull_policy: never"), "Unexpected managed stack");
const previousImage = previous.match(/image: (project-stack-structure-web:[a-z0-9-]+)/)?.[1];
assert(previousImage, "Managed image reference is missing");
writeFileSync(`${release}/compose-before.yaml`, previous, { mode: 0o600 });
const updated = previous.replace(/image: project-stack-structure-web:[a-z0-9-]+/, `image: ${image}`);
const pause = () => new Promise(done => setTimeout(done, 2000));
async function activate(content) {
  assert((await api(composePath, "PUT", { content, restart: false })).success, "Compose save failed");
  const deployment = await api(stack + "/deploy?env=3", "POST", { pull: false, build: false, forceRecreate: true });
  if (deployment.jobId) {
    for (let attempt = 0; attempt < 120; attempt++) {
      const job = await api("/api/jobs/" + encodeURIComponent(deployment.jobId));
      if (job.status === "done") { assert(job.result?.success === true, "Managed deployment failed"); return; }
      assert(!["failed", "cancelled", "error"].includes(job.status) && attempt < 119, "Managed deployment failed or timed out");
      await pause();
    }
  } else assert(deployment.success, "Managed deployment was not accepted");
}
async function healthy(expectedImage) {
  for (let attempt = 0; attempt < 90; attempt++) {
    const inspect = spawnSync("docker", ["inspect", "project-stack-structure-web", "--format", "{{.Config.Image}} {{.State.Health.Status}}"], { encoding: "utf8" });
    if (inspect.status === 0 && inspect.stdout.trim() === expectedImage + " healthy") return;
    await pause();
  }
  throw new Error("Exact app image did not become healthy");
}
async function verify() {
  for (const origin of ["http://127.0.0.1:18102", runtime.AUTH_URL]) {
    const response = await fetch(origin + "/health", { cache: "no-store", signal: AbortSignal.timeout(30_000) });
    assert(response.ok && (await response.json()).revision === revision, "Origin/public revision mismatch");
    const denied = await fetch(origin + "/api/studio/projects", { redirect: "manual", signal: AbortSignal.timeout(30_000) });
    assert(denied.status === 401, "Anonymous project access must stay locked");
  }
  const retained = await api(composePath);
  assert(retained.content === updated, "Dockhand did not retain the exact release");
}
try {
  await activate(updated);
  await healthy(image);
  await verify();
  console.log(JSON.stringify({ revision, image, managed: true, publicRevisionMatches: true, anonymousProjectAccess: "denied" }));
} catch (error) {
  console.error("Deployment verification failed; restoring the previous Dockhand release.");
  await activate(previous);
  await healthy(previousImage);
  throw error;
}
