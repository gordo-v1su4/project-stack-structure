export function authRedirectProxyUrl(authUrl: string | undefined) {
  if (!authUrl) return undefined;

  const url = new URL(authUrl);
  url.pathname = "/api/auth";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

export function canonicalAuthRedirect(url: string, baseUrl: string, authUrl: string | undefined) {
  const canonicalBase = new URL(authUrl ?? baseUrl);
  canonicalBase.pathname = "/";
  canonicalBase.search = "";
  canonicalBase.hash = "";

  const target = new URL(url, canonicalBase);
  return target.origin === canonicalBase.origin ? target.toString() : canonicalBase.toString();
}

export function localAuthOriginRedirects(authUrl: string | undefined) {
  if (!authUrl) return [];

  const canonicalOrigin = new URL(authUrl);
  if (canonicalOrigin.hostname !== "127.0.0.1") return [];

  return [
    {
      source: "/:path*",
      has: [{ type: "host" as const, value: "localhost" }],
      destination: `${canonicalOrigin.origin}/:path*`,
      permanent: false,
    },
  ];
}
