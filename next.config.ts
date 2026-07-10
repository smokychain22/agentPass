import type { NextConfig } from "next";
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
  ],
  outputFileTracingIncludes: {
    "/api/**": [
      "./demo-repos/**/*",
      "./scripts/madge-scan.mjs",
      ...analyzerTraceIncludes,
    ],
  },
};

export default nextConfig;
