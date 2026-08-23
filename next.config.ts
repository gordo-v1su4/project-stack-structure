import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";
import { localAuthOriginRedirects } from "./src/lib/authRequest";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const configuredAuthUrl = process.env.AUTH_URL ?? process.env.NEXTAUTH_URL;

// SECURITY: never re-expose server credentials through nextConfig.env — it
// inlines values into the browser bundle (FFMPEG_GATEWAY_API_KEY and
// NEXT_PUBLIC_ESSENTIA_API_KEY previously shipped to every client).
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  async redirects() {
    return localAuthOriginRedirects(configuredAuthUrl);
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  turbopack: {
    root: projectRoot,
  },
  // The review module's LFM-2.5-VL captioner runs client-side in a Web Worker
  // (WebGPU). Keep transformers out of the server bundle.
  serverExternalPackages: ["@huggingface/transformers"],
};

export default nextConfig;
