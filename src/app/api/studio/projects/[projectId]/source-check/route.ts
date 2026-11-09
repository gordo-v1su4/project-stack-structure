import { handleSourceStorageCheck } from "./sourceCheck";

export const runtime = "nodejs";

/** Explicit POST prevents navigation/prefetch from launching extra storage reads. */
export async function POST(_request: Request, context: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await context.params;
  return handleSourceStorageCheck(projectId);
}
