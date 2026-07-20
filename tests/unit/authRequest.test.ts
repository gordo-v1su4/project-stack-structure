import { describe, expect, test } from "bun:test";
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
  });
});
