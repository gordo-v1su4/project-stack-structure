import { describe, expect, test } from "bun:test";
import { getRedirectUrl, unstable_getResponseFromNextConfig } from "next/experimental/testing/server";
import {
  authRedirectProxyUrl,
  canonicalAuthRedirect,
  localAuthOriginRedirects,
} from "../../src/lib/authRequest";

describe("canonical Auth.js origin", () => {
  test("builds an Auth.js redirect proxy URL without normalizing the loopback literal", () => {
    expect(authRedirectProxyUrl("http://127.0.0.1:3005")).toBe("http://127.0.0.1:3005/api/auth");
    expect(authRedirectProxyUrl("https://studio.example.com/base?stale=1#old")).toBe("https://studio.example.com/api/auth");
    expect(authRedirectProxyUrl(undefined)).toBe(undefined);
  });

  test("keeps post-login redirects on the canonical origin", () => {
    const canonical = "http://127.0.0.1:3005";
    const normalizedByNext = "http://localhost:3005";

    expect(canonicalAuthRedirect("/", normalizedByNext, canonical)).toBe("http://127.0.0.1:3005/");
    expect(canonicalAuthRedirect("http://127.0.0.1:3005/projects", normalizedByNext, canonical)).toBe("http://127.0.0.1:3005/projects");
    expect(canonicalAuthRedirect("https://attacker.example/phish", normalizedByNext, canonical)).toBe("http://127.0.0.1:3005/");
  });

  test("falls back to the request base URL without an explicit auth origin", () => {
    expect(canonicalAuthRedirect("/projects", "https://studio.example.com", undefined)).toBe("https://studio.example.com/projects");
  });

  test("redirects localhost to the configured literal loopback origin before Auth.js sets cookies", () => {
    expect(localAuthOriginRedirects("http://127.0.0.1:3005")).toEqual([
      {
        source: "/:path*",
        has: [{ type: "host", value: "localhost" }],
        destination: "http://127.0.0.1:3005/:path*",
        permanent: false,
      },
    ]);
  });

  test("does not add a localhost redirect for hosted or unspecified auth origins", () => {
    expect(localAuthOriginRedirects("https://studio.example.com")).toEqual([]);
    expect(localAuthOriginRedirects(undefined)).toEqual([]);
    expect(localAuthOriginRedirects("file://localhost/tmp/auth")).toEqual([]);
    expect(localAuthOriginRedirects("https://localhost.example.com")).toEqual([]);
  });

  test("an explicit dev port canonicalizes loopback before sign-in when AUTH_URL is unset", async () => {
    const redirects = localAuthOriginRedirects(undefined, "3000");
    expect(redirects[0]).toMatchObject({ destination: "http://localhost:3000/:path*", has: [{ type: "host", value: "127\\.0\\.0\\.1" }] });
    const response = await unstable_getResponseFromNextConfig({ url: "http://127.0.0.1:3000/", nextConfig: { redirects: async () => redirects } });
    expect(response.status).toBe(307);
    expect(new URL(getRedirectUrl(response)!).hostname).toBe("localhost");
    expect(localAuthOriginRedirects(undefined, "3005")[0].destination).toBe("http://localhost:3005/:path*");
    expect(localAuthOriginRedirects("https://studio.example.com", "3000")).toEqual([]);
    expect(() => localAuthOriginRedirects(undefined, "0")).toThrow("valid port");
    expect(() => localAuthOriginRedirects(undefined, "3000/path")).toThrow("valid port");
    // Omitting the dev-only argument keeps production/unconfigured routing untouched.
    expect(localAuthOriginRedirects(undefined)).toEqual([]);
  });

  for (const [canonical, alias] of [
    ["http://localhost:3000", "http://127.0.0.1:3000"],
    ["http://127.0.0.1:3005", "http://localhost:3005"],
  ]) {
    test(`Next redirects ${alias} to ${canonical} before auth, preserving callback path and query`, async () => {
      const nextConfig = { redirects: async () => localAuthOriginRedirects(canonical) };
      const response = await unstable_getResponseFromNextConfig({ url: `${alias}/api/auth/callback/github?code=synthetic&state=test`, nextConfig });
      expect(response.status).toBe(307);
      // Next 16.2.1's experimental response helper reconstructs external URLs
      // from hostname without port. Check the configured port independently;
      // the signed-in browser flow verifies the real HTTP Location header.
      expect(localAuthOriginRedirects(canonical)[0].destination).toBe(`${canonical}/:path*`);
      const redirected = new URL(getRedirectUrl(response)!);
      expect(redirected.hostname).toBe(new URL(canonical).hostname);
      expect(redirected.pathname).toBe("/api/auth/callback/github");
      expect(redirected.search).toBe("?code=synthetic&state=test");
      const canonicalResponse = await unstable_getResponseFromNextConfig({ url: `${canonical}/api/auth/signin/github`, nextConfig });
      expect(getRedirectUrl(canonicalResponse)).toBe(null);
    });
  }

  test("literal alias matching does not redirect unrelated hosts or production requests", async () => {
    const localConfig = { redirects: async () => localAuthOriginRedirects("http://localhost:3000") };
    for (const host of ["127x0x0x1", "127.0.0.1.attacker.example", "studio.example.com"]) {
      const response = await unstable_getResponseFromNextConfig({ url: `http://${host}:3000/projects`, nextConfig: localConfig });
      expect(getRedirectUrl(response)).toBe(null);
    }
    const hostedConfig = { redirects: async () => localAuthOriginRedirects("https://studio.example.com") };
    const production = await unstable_getResponseFromNextConfig({ url: "https://studio.example.com/projects", nextConfig: hostedConfig });
    expect(getRedirectUrl(production)).toBe(null);
    expect(canonicalAuthRedirect("http://localhost:3000/projects", "https://studio.example.com", "https://studio.example.com")).toBe("https://studio.example.com/");
    expect(canonicalAuthRedirect("//attacker.example/phish", "https://studio.example.com", "https://studio.example.com")).toBe("https://studio.example.com/");
  });
});
