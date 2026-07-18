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
};

export default withWorkflow(nextConfig);
