import { createShotPlanningHandlers } from "./shotPlanningRoute";

export const runtime = "nodejs";
const handlers = createShotPlanningHandlers();
export const GET = handlers.GET;
export const POST = handlers.POST;
