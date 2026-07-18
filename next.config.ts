import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";
import analyzerTraceIncludes from "./analyzer-trace-includes.json";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  env: {
    // Expose deployment channel to the client for PREVIEW / PRODUCTION safety banners.
    NEXT_PUBLIC_VERCEL_ENV: process.env.VERCEL_ENV ?? process.env.NEXT_PUBLIC_VERCEL_ENV ?? "",
  },
  serverExternalPackages: [
    "knip",
    "jscpd",
    "madge",
    "execa",
    "typescript",
    "commander",
    "formatly",
    "commondir",
    "formdata-node",
    "fd-package-json",
    "walkdir",
    "workflow",
  ],
  outputFileTracingIncludes: {
    "/api/**": [
      "./demo-repos/**/*",
      "./scripts/madge-scan.mjs",
      ...analyzerTraceIncludes,
    ],
  },
  webpack: (config, { isServer }) => {
    // Prevent accidental client bundling of Node builtins (plan-hash / quote HMAC).
    if (!isServer) {
      config.resolve = config.resolve ?? {};
      config.resolve.fallback = {
        ...(config.resolve.fallback ?? {}),
        crypto: false,
        fs: false,
        path: false,
        os: false,
      };
      config.resolve.alias = {
        ...(config.resolve.alias ?? {}),
        "@/lib/user-directed/plan-hash": false,
        "@/lib/user-directed/dynamic-quote-engine": false,
        "@/lib/user-directed/analyze-requested-action": false,
        "node:crypto": false,
      };
    }
    return config;
  },
};

export default withWorkflow(nextConfig);
