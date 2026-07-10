import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["knip", "jscpd", "madge", "execa", "typescript"],
  outputFileTracingIncludes: {
    "/api/**": [
      "./demo-repos/**/*",
      "./node_modules/knip/**/*",
      "./node_modules/jscpd/**/*",
      "./node_modules/madge/**/*",
      "./scripts/madge-scan.mjs",
    ],
  },
};

export default nextConfig;
