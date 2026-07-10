import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["knip", "jscpd", "madge", "execa", "typescript", "commander", "formatly", "commondir"],
  outputFileTracingIncludes: {
    "/api/**": [
      "./demo-repos/**/*",
      "./node_modules/knip/**/*",
      "./node_modules/formatly/**/*",
      "./node_modules/jscpd/**/*",
      "./node_modules/jscpd-linux-x64-gnu/**/*",
      "./node_modules/jscpd-sarif-reporter/**/*",
      "./node_modules/@jscpd/**/*",
      "./node_modules/madge/**/*",
      "./node_modules/commondir/**/*",
      "./node_modules/commander/**/*",
      "./node_modules/typescript/**/*",
      "./scripts/madge-scan.mjs",
    ],
  },
};

export default nextConfig;
