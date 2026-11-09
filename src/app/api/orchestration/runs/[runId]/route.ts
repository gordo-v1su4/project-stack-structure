import { retrieveTriggerRun } from "@/lib/triggerOrchestration";
import { getSessionUser } from "@/lib/session";
import { createRunLookupHandler } from "./runLookupRoute";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = createRunLookupHandler({ session: getSessionUser, retrieve: retrieveTriggerRun });
