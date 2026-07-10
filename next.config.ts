import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["knip", "jscpd", "execa"],
  outputFileTracingIncludes: {
    "/api/**": ["./demo-repos/**/*"],
  },
};

export default nextConfig;
