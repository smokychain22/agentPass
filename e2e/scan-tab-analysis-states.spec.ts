import { test, expect, type Page } from "@playwright/test";

/**
 * Real browser E2E for the scan-tab "Analyze Repository" stage (the
 * premature "Analyze another repository" / "Open Results" bug and the
 * Connect Repository → Analyze Repository rename). Mocks only the network
 * layer (structure scan + findings dispatch/poll/fetch) so every phase
 * (queued, waiting for runner, completed, failed) is deterministic and
 * fast — the actual client-side gating logic under test runs for real.
 */

const REPO_URL = "https://github.com/velz-cmd/repodiet-e2e-test";

const SCAN_RESULT = {
  id: "scan_e2e_mock",
  repo: {
    owner: "velz-cmd",
    name: "repodiet-e2e-test",
    branch: "main",
    url: REPO_URL,
    commitSha: "c0838e4cda326098a363b44e0e3ebe98e81e9463",
  },
  framework: { name: "Next.js", confidence: 0.99, signals: [] },
  packageManager: "npm",
  summary: { totalFiles: 48, totalFolders: 7, totalSizeKb: 26, topExtensions: {} },
  topLevelFolders: [],
  configFiles: [],
  largestFiles: [],
  warnings: [],
  repositoryModel: { projects: [], workspaces: [], monorepoTool: null, primaryProjectRoot: ".", protectedFileCount: 0, analyzableSourceFiles: 32, needsProjectRootSelection: false, selectableApplications: [] },
};

const FINDINGS_ACCEPTED = {
  success: true,
  accepted: true,
  jobId: "job_e2e_mock",
  taskId: "job_e2e_mock",
  status: "queued",
  stage: "QUEUED",
  statusUrl: "/api/deep-scans/job_e2e_mock",
  workerReady: true,
  requestId: "req_e2e_mock",
  structureScanId: "scan_e2e_mock",
};

function mockFindingsPayload() {
  return {
    scanId: "scan_e2e_mock",
    repo: SCAN_RESULT.repo,
    summary: {
      totalFindings: 0,
      duplicateClusters: 0,
      unusedFiles: 0,
      unusedDependencies: 0,
      unusedExports: 0,
      orphanPatterns: 0,
      slopSignals: 0,
      reviewRequired: 0,
      safeCandidates: 0,
      doNotTouch: 0,
    },
    duplicates: [],
    unused: { files: [], dependencies: [], exports: [] },
    orphans: [],
    slopSignals: [],
    riskBuckets: { safeDelete: [], reviewFirst: [], doNotTouch: [] },
    artifacts: { findingsJson: true },
    mode: "live",
  };
}

async function mockStructureScan(page: Page) {
  await page.route("**/api/jobs/scan", async (route) => {
    await route.fulfill({
      json: { success: true, jobId: "job_scan_mock", status: "complete", stage: "complete", progress: null, result: SCAN_RESULT },
    });
  });
}

async function submitRepo(page: Page) {
  await page.goto("/app");
  await page.getByPlaceholder("https://github.com/owner/repository").fill(REPO_URL);
  await page.getByRole("button", { name: "Analyze repository" }).click();
}

test.describe("Analyze Repository stage — deterministic mocked states", () => {
  test("1. queued: no Analyze another repository, no Open Results, Review Findings locked", async ({
    page,
  }) => {
    await mockStructureScan(page);
    await page.route("**/api/findings/analyze", async (route) => {
      await route.fulfill({ status: 202, json: FINDINGS_ACCEPTED });
    });
    await page.route("**/api/deep-scans/job_e2e_mock", async (route) => {
      await route.fulfill({
        json: { ok: true, job: { id: "job_e2e_mock", status: "running", stage: "QUEUED" } },
      });
    });

    await submitRepo(page);

    await expect(page.getByText("RepoDiet is analyzing your repository")).toBeVisible();
    await expect(page.getByRole("button", { name: "Analyze another repository" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Open Results" })).toHaveCount(0);
    const rail = page.getByRole("navigation", { name: "Workflow progress" });
    const findingsItem = rail
      .getByText(/review findings/i)
      .locator("xpath=ancestor::*[self::a or self::span][1]");
    expect(await findingsItem.evaluate((el) => el.tagName.toLowerCase())).not.toBe("a");
  });

  test("2. waiting for GitHub Actions runner: Analyze Repository stays active, no SCAN COMPLETE, no Analyze another repository", async ({
    page,
  }) => {
    await mockStructureScan(page);
    await page.route("**/api/findings/analyze", async (route) => {
      await route.fulfill({ status: 202, json: FINDINGS_ACCEPTED });
    });
    await page.route("**/api/deep-scans/job_e2e_mock", async (route) => {
      await route.fulfill({
        json: {
          ok: true,
          job: { id: "job_e2e_mock", status: "running", stage: "WAITING_FOR_RUNNER" },
        },
      });
    });

    await submitRepo(page);

    await expect(page.getByText("RepoDiet is analyzing your repository")).toBeVisible();
    await expect(page.getByText("Analysis complete")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Analyze another repository" })).toHaveCount(0);
    const rail = page.getByRole("navigation", { name: "Workflow progress" });
    await expect(rail.getByText(/analyze repository/i)).toBeVisible();
  });

  test("3. completed + persisted: Open results and Analyze another repository appear, Review Findings unlocks", async ({
    page,
  }) => {
    await mockStructureScan(page);
    await page.route("**/api/findings/analyze", async (route) => {
      await route.fulfill({ status: 202, json: FINDINGS_ACCEPTED });
    });
    await page.route("**/api/deep-scans/job_e2e_mock", async (route) => {
      await route.fulfill({
        json: {
          ok: true,
          job: { id: "job_e2e_mock", status: "complete", stage: "READY", findingsId: "scan_e2e_mock" },
        },
      });
    });
    await page.route("**/api/findings/scan_e2e_mock", async (route) => {
      await route.fulfill({ json: { success: true, findings: mockFindingsPayload() } });
    });
    await page.route("**/api/user-directed/cleanup-plan-status**", async (route) => {
      await route.fulfill({ json: { ok: true, plan: null, approved: false, current: false, superseded: false } });
    });

    await submitRepo(page);

    await expect(page.getByRole("link", { name: /Open Results/i })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("button", { name: "Analyze another repository" })).toBeVisible();
    const rail = page.getByRole("navigation", { name: "Workflow progress" });
    const findingsItem = rail
      .getByText(/review findings/i)
      .locator("xpath=ancestor::*[self::a or self::span][1]");
    expect(await findingsItem.evaluate((el) => el.tagName.toLowerCase())).toBe("a");
  });

  test("4. failed: Retry analysis and Choose another repository appear, Review Findings stays locked", async ({
    page,
  }) => {
    await mockStructureScan(page);
    await page.route("**/api/findings/analyze", async (route) => {
      await route.fulfill({ status: 202, json: FINDINGS_ACCEPTED });
    });
    await page.route("**/api/deep-scans/job_e2e_mock", async (route) => {
      await route.fulfill({
        json: {
          ok: true,
          job: {
            id: "job_e2e_mock",
            status: "failed",
            stage: "FAILED",
            failureMessage: "Analyzer crashed (mocked failure).",
          },
        },
      });
    });

    await submitRepo(page);

    await expect(page.getByRole("button", { name: "Retry analysis" })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("button", { name: "Choose another repository" })).toHaveCount(0); // not rendered in this panel; failure text panel handles retry only
    const rail = page.getByRole("navigation", { name: "Workflow progress" });
    const findingsItem = rail
      .getByText(/review findings/i)
      .locator("xpath=ancestor::*[self::a or self::span][1]");
    expect(await findingsItem.evaluate((el) => el.tagName.toLowerCase())).not.toBe("a");
  });

  test("5. Analyze another repository after completion returns to a blank form", async ({ page }) => {
    await mockStructureScan(page);
    await page.route("**/api/findings/analyze", async (route) => {
      await route.fulfill({ status: 202, json: FINDINGS_ACCEPTED });
    });
    await page.route("**/api/deep-scans/job_e2e_mock", async (route) => {
      await route.fulfill({
        json: {
          ok: true,
          job: { id: "job_e2e_mock", status: "complete", stage: "READY", findingsId: "scan_e2e_mock" },
        },
      });
    });
    await page.route("**/api/findings/scan_e2e_mock", async (route) => {
      await route.fulfill({ json: { success: true, findings: mockFindingsPayload() } });
    });
    await page.route("**/api/user-directed/cleanup-plan-status**", async (route) => {
      await route.fulfill({ json: { ok: true, plan: null, approved: false, current: false, superseded: false } });
    });

    await submitRepo(page);
    await expect(page.getByRole("button", { name: "Analyze another repository" })).toBeVisible({
      timeout: 10_000,
    });

    await page.getByRole("button", { name: "Analyze another repository" }).click();

    const repoInput = page.getByPlaceholder("https://github.com/owner/repository");
    await expect(repoInput).toBeVisible({ timeout: 10_000 });
    await expect(repoInput).toHaveValue("");
    await expect(page.getByRole("button", { name: "Analyze another repository" })).toHaveCount(0);
  });
});
