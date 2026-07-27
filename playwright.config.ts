import { defineConfig } from "@playwright/test";

/**
 * Minimal browser E2E config. Targets the deployed production URL by
 * default (REPODIET_E2E_BASE_URL overrides it) — the app requires a large
 * set of provider secrets (OKX payment, GitHub App, Redis) to boot locally,
 * so these tests verify real, already-deployed navigation/gating behavior
 * rather than spinning up a local server.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.REPODIET_E2E_BASE_URL || "https://skillswap-virid-kappa.vercel.app",
    trace: "retain-on-failure",
  },
});
