import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const publicEssentiaApiBaseUrl = (
  process.env.NEXT_PUBLIC_ESSENTIA_API_BASE_URL ??
  process.env.NEXT_PUBLIC_ESSENTIA_API_URL ??
  process.env.VITE_ESSENTIA_API_BASE_URL ??
  process.env.VITE_ESSENTIA_API_URL ??
  ""
).trim();
const publicEssentiaApiKey = (
  process.env.NEXT_PUBLIC_ESSENTIA_API_KEY ??
  process.env.VITE_ESSENTIA_API_KEY ??
  ""
).trim();

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_ESSENTIA_API_BASE_URL: publicEssentiaApiBaseUrl,
    NEXT_PUBLIC_ESSENTIA_API_URL: publicEssentiaApiBaseUrl,
    NEXT_PUBLIC_ESSENTIA_API_KEY: publicEssentiaApiKey,
  },
  turbopack: {
    root: projectRoot,
  },
};

export default nextConfig;
