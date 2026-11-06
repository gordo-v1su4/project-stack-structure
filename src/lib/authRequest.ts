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

export function localAuthOriginRedirects(authUrl: string | undefined, developmentPort?: string) {
  // NextURL normalizes loopback request URLs to localhost even without AUTH_URL.
  // Only the dev-server config supplies this fallback; hosted origins stay inferred.
  if (!authUrl && developmentPort !== undefined) {
    if (!/^\d+$/.test(developmentPort) || Number(developmentPort) < 1 || Number(developmentPort) > 65535) {
      throw new Error("Local auth redirects require the development server's valid port.");
    }
    authUrl = `http://localhost:${developmentPort}`;
  }
  if (!authUrl) return [];

  const canonicalOrigin = new URL(authUrl);
  if (canonicalOrigin.protocol !== "http:" && canonicalOrigin.protocol !== "https:") return [];
  // Auth.js rewrites request URLs to AUTH_URL, but cookies stay on the host
  // the browser visited. Normalize the other loopback alias before any sign-in
  // endpoint sets state/PKCE cookies, whichever alias the OAuth app uses.
  const alias = canonicalOrigin.hostname === "127.0.0.1"
    ? "localhost"
    : canonicalOrigin.hostname === "localhost" ? "127\\.0\\.0\\.1" : null;
  if (!alias) return [];

  return [
    {
      source: "/:path*",
      has: [{ type: "host" as const, value: alias }],
      destination: `${canonicalOrigin.origin}/:path*`,
      permanent: false,
    },
  ];
}
