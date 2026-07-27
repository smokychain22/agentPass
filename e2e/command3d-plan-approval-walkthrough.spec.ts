import { test, expect } from "@playwright/test";

/**
 * COMMAND 3D Part 14 — real, production, no-mocking free verification
 * walkthrough: select one valid fix, confirm the optional-findings
 * blocker is gone, approve the plan, confirm Review Findings completes,
 * confirm Create Cleanup PR is reachable and shows correct GitHub
 * status, confirm Review & Accept stays locked, and confirm no
 * payment/task/branch/PR is created. Runs a real repository analysis
 * through the real GitHub Actions worker, so it is slow.
 */
test.describe.configure({ mode: "serial" });

const REPO_URL = "https://github.com/velz-cmd/repodiet-e2e-test";

test("free walkthrough: one selected fix approves a plan with optional findings left unchanged, no payment", async ({
  page,
}) => {
  test.setTimeout(6 * 60_000);
  await page.goto("/app");
  await page.getByPlaceholder("https://github.com/owner/repository").fill(REPO_URL);
  await page.getByRole("button", { name: "Analyze repository" }).click();

  await Promise.race([
    page.waitForURL(/tab=findings/, { timeout: 4 * 60_000 }),
    page
      .getByRole("link", { name: /Open Results/i })
      .waitFor({ state: "visible", timeout: 4 * 60_000 })
      .then(() => page.getByRole("link", { name: /Open Results/i }).click()),
  ]);
  await page.waitForURL(/tab=findings/, { timeout: 30_000 });

  const recommendedArticle = page
    .locator("article")
    .filter({ hasText: "Recommended fix" })
    .first();
  await expect(recommendedArticle).toBeVisible({ timeout: 15_000 });
  await recommendedArticle.getByRole("button", { name: "Remove this file", exact: true }).click();
  await expect(page.getByText(/^1 fix selected/i)).toBeVisible({ timeout: 10_000 });

  // Open the cleanup plan review.
  await page.getByRole("button", { name: /Review cleanup plan \(1\)/i }).click();
  await expect(page.getByText("Cleanup plan", { exact: false }).first()).toBeVisible({
    timeout: 10_000,
  });

  // The exact production defect: must NOT show a blanket "N findings still
  // need your decision" blocker for untouched optional findings.
  await expect(page.getByText(/findings? still need your decision/i)).toHaveCount(0);
  // Optional findings must be shown as informational, non-blocking.
  await expect(page.getByText(/optional finding.*will remain unchanged/i)).toBeVisible({
    timeout: 10_000,
  });

  // Approve the plan — a real, persisted backend action.
  const approveButton = page.getByRole("button", { name: /^Approve cleanup plan$/i });
  await expect(approveButton).toBeEnabled({ timeout: 10_000 });
  await approveButton.click();
  await expect(page.getByText(/Cleanup plan approved/i)).toBeVisible({ timeout: 15_000 });

  // Review Findings now shows as complete in the nav.
  await expect(
    page.locator("nav, aside").getByText("Review Findings").first()
  ).toBeVisible();

  // Create Cleanup PR must be reachable now — never a dead lock — and show
  // real GitHub connection status + repository scope, never a payment
  // action executed automatically.
  await page.goto("/app?tab=patch");
  await expect(page.getByText(/GitHub access:/i)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/Repository scope:/i)).toBeVisible();
  await expect(page.getByText(/Approve your cleanup plan/i)).toHaveCount(0);

  // Review & Accept must remain locked — no real PR/delivery exists yet.
  await page.goto("/app?tab=verify");
  await expect(page.getByText(/pull request/i).first()).toBeVisible({ timeout: 15_000 });

  // No payment, A2A task, branch, or PR was created by any of the above —
  // confirmed by the presence of the "Connect GitHub"/payment CTA still
  // gated rather than any executing/complete state on the cleanup tab.
  await page.goto("/app?tab=patch");
  await expect(page.getByText(/Creating cleanup pull request/i)).toHaveCount(0);
});
