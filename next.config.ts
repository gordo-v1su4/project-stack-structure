import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";
import { localAuthOriginRedirects } from "./src/lib/authRequest";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const configuredAuthUrl = process.env.AUTH_URL ?? process.env.NEXTAUTH_URL;
const publicEssentiaApiBaseUrl = (
  process.env.NEXT_PUBLIC_ESSENTIA_API_BASE_URL ??
  process.env.NEXT_PUBLIC_ESSENTIA_API_URL ??
  ""
).trim();
const publicEssentiaApiKey = (
  process.env.NEXT_PUBLIC_ESSENTIA_API_KEY ??
  ""
).trim();

const serverFfmpegGatewayUrl = (
  process.env.FFMPEG_GATEWAY_URL ??
  ""
).trim().replace(/\/+$/, "");

const serverFfmpegGatewayApiKey = (
  process.env.FFMPEG_GATEWAY_API_KEY ??
  ""
).trim();

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  async redirects() {
    return localAuthOriginRedirects(configuredAuthUrl);
  },
  env: {
    NEXT_PUBLIC_ESSENTIA_API_BASE_URL: publicEssentiaApiBaseUrl,
    NEXT_PUBLIC_ESSENTIA_API_URL: publicEssentiaApiBaseUrl,
    NEXT_PUBLIC_ESSENTIA_API_KEY: publicEssentiaApiKey,
    FFMPEG_GATEWAY_URL: serverFfmpegGatewayUrl,
    FFMPEG_GATEWAY_API_KEY: serverFfmpegGatewayApiKey,
  },
  turbopack: {
    root: projectRoot,
  },
  // The review module's LFM-2.5-VL captioner runs client-side in a Web Worker
  // (WebGPU). Keep transformers out of the server bundle.
  serverExternalPackages: ["@huggingface/transformers"],
};

export default nextConfig;
