import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";
import analyzerTraceIncludes from "./analyzer-trace-includes.json";

const nextConfig: NextConfig = {
  reactStrictMode: true,
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
