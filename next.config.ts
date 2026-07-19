import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";
import analyzerTraceIncludes from "./analyzer-trace-includes.json";

const analyzerIncludes = [
  "./demo-repos/**/*",
  "./scripts/madge-scan.mjs",
  ...analyzerTraceIncludes,
];

/** Only analyzer-backed routes need the heavy NFT includes — not every /api/** route. */
const analyzerApiRoutes = [
  "/api/jobs/findings/**",
  "/api/findings/**",
  "/api/tools/**",
  "/api/cleanup/**",
  "/api/patch-kit/**",
  "/api/patches/**",
  "/api/a2mcp/**",
  "/api/internal/a2mcp/**",
  "/api/internal/sandbox-runs/**",
  "/api/workflow/**",
  "/api/scans/**",
];

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
  outputFileTracingIncludes: Object.fromEntries(
    analyzerApiRoutes.map((route) => [route, analyzerIncludes])
  ),
};

export default withWorkflow(nextConfig);
