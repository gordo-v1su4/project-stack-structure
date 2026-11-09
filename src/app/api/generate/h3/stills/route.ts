import { createH3StillHandlers } from "./stillRoute";

export const runtime = "nodejs";
const handlers = createH3StillHandlers();
export const POST = handlers.POST;
export const GET = handlers.GET;
export const DELETE = handlers.DELETE;
export const PATCH = handlers.PATCH;
