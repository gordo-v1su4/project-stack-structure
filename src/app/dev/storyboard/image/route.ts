export function GET() {
  if (process.env.NODE_ENV !== "development") return new Response(null, { status: 404 });
  return new Response('<svg xmlns="http://www.w3.org/2000/svg" width="2048" height="1152"><rect width="2048" height="1152" fill="#18181b"/><path d="M0 980L700 500L1300 900L2048 300V1152H0" fill="#3f3f46"/><text x="80" y="180" fill="#e4e4e7" font-size="80">BROWSER FIXTURE · NOT GENERATED</text></svg>', { headers: { "Content-Type": "image/svg+xml", "Cache-Control": "no-store" } });
}
