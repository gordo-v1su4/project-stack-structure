import { getSessionUser } from "@/lib/session";
import { H3ShotPlanningError, loadH3ShotPlanningContext } from "@/lib/h3ShotPlanningServer";
import { readH3ShotPlan } from "@/lib/h3ShotPlanningStore";
import { triggerH3ShotPlanning } from "@/lib/triggerOrchestration";

const reply = (value: unknown, status: number) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
type Dependencies = { session: typeof getSessionUser; load: typeof loadH3ShotPlanningContext;
  read: typeof readH3ShotPlan; trigger: (...args: Parameters<typeof triggerH3ShotPlanning>) => Promise<{ id: string }> };
const defaults: Dependencies = { session: getSessionUser, load: loadH3ShotPlanningContext, read: readH3ShotPlan, trigger: triggerH3ShotPlanning };

async function readBody(request: Request) {
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json" || !request.body) throw new H3ShotPlanningError("Use a JSON planning request.", 400);
  const reader = request.body.getReader();
  let bytes = 0;
  const chunks: Uint8Array[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new H3ShotPlanningError("Planning request timed out.", 408)), 10_000); });
  try {
    while (true) {
      const part = await Promise.race([reader.read(), timeout]);
      if (part.done) break;
      bytes += part.value.length;
      if (bytes > 4096) throw new H3ShotPlanningError("Planning request is too large.", 413);
      chunks.push(part.value);
    }
    const data = new Uint8Array(bytes);
    let offset = 0; for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
    try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(data)); }
    catch { throw new H3ShotPlanningError("Invalid planning request JSON.", 400); }
  } finally { clearTimeout(timer); void reader.cancel().catch(() => {}); }
}

export function createShotPlanningHandlers(dependencies: Dependencies = defaults) {
  async function handle(request: Request, dispatch: boolean) {
    const user = await dependencies.session();
    if (!user) return reply({ success: false, error: "Sign in before preparing shot directions." }, 401);
    try {
      const value = dispatch ? await readBody(request) : Object.fromEntries(new URL(request.url).searchParams);
      if (!value || typeof value !== "object" || Array.isArray(value)
        || Object.keys(value).some(key => !["projectId", "planSignature", "bindingSha256", ...(dispatch ? ["attempt"] : [])].includes(key))) {
        throw new H3ShotPlanningError("Invalid planning request fields.", 400);
      }
      const { projectId, planSignature, bindingSha256, attempt = 0 } = value;
      if (typeof projectId !== "string" || !/^[a-z0-9_-]{1,96}$/.test(projectId)
        || typeof planSignature !== "string" || !planSignature.trim() || planSignature.length > 200
        || (bindingSha256 !== undefined && (typeof bindingSha256 !== "string" || !/^[a-f0-9]{64}$/.test(bindingSha256)))
        || !Number.isInteger(attempt) || attempt < 0 || attempt > 2) throw new H3ShotPlanningError("Invalid planning request context.", 400);
      const { input } = await dependencies.load(user.id, projectId, { planSignature, bindingSha256 });
      const result = await dependencies.read(user.id, projectId, input);
      if (result) return reply({ success: true, state: "ready", bindingSha256: input.bindingSha256, result }, 200);
      if (!dispatch) return reply({ success: true, state: "missing", bindingSha256: input.bindingSha256 }, 200);
      const queued = await dependencies.trigger({ ownerId: user.id, projectId, planSignature: input.planSignature, bindingSha256: input.bindingSha256 }, attempt);
      return reply({ success: true, state: "queued", bindingSha256: input.bindingSha256, runId: queued.id }, 202);
    } catch (error) {
      return reply({ success: false, error: error instanceof H3ShotPlanningError ? error.message : "Shot planning could not complete. Existing footage is unchanged." }, error instanceof H3ShotPlanningError ? error.status : 503);
    }
  }
  return { GET: (request: Request) => handle(request, false), POST: (request: Request) => handle(request, true) };
}
