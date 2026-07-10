import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["knip", "jscpd", "madge", "execa", "typescript", "commander"],
  outputFileTracingIncludes: {
    "/api/**": [
      "./demo-repos/**/*",
      "./node_modules/knip/**/*",
      "./node_modules/jscpd/**/*",
      "./node_modules/jscpd-sarif-reporter/**/*",
      "./node_modules/@jscpd/**/*",
      "./node_modules/madge/**/*",
      "./node_modules/commander/**/*",
      "./node_modules/typescript/**/*",
      "./scripts/madge-scan.mjs",
    ],
  },
};

export default nextConfig;
