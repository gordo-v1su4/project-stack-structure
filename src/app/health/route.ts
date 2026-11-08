export const dynamic = "force-dynamic";

// Deliberately outside /api: public liveness exposes only release identity.
export function GET() {
  return Response.json({ service: "project-stack-structure", revision: process.env.APP_REVISION ?? "development" }, {
    headers: { "cache-control": "no-store" },
  });
}
