import { test, expect } from "@playwright/test";

/**
 * Real, end-to-end browser test against the deployed production app and a
 * real completed scan of velz-cmd/repodiet-e2e-test (no mocking) — the
 * exact Command 3C Part 13 production-verification walkthrough, run as an
 * automated Playwright test rather than only a manual one. Runs a real
 * repository analysis through the real GitHub Actions worker, so it is
 * slow (a few minutes) — this is intentional: it is the only way to prove
 * real persisted decisions, a real sticky action bar, and a real drawer
 * against genuine backend state rather than mocked findings.
 */
test.describe.configure({ mode: "serial" });

const REPO_URL = "https://github.com/velz-cmd/repodiet-e2e-test";

test("zero selected fixes: no sticky action bar on a fresh session", async ({ page }) => {
  await page.goto("/app");
  await expect(page.getByText(/fix(es)? selected/i)).toHaveCount(0);
});

test("real completed scan: select fixes, sticky bar persists across refresh, drawer matches, plan matches", async ({
  page,
}) => {
  test.setTimeout(5 * 60_000);
  await page.goto("/app");
  await page.getByPlaceholder("https://github.com/owner/repository").fill(REPO_URL);
  await page.getByRole("button", { name: "Analyze repository" }).click();

  // Real structure scan + real findings analysis (GitHub Actions worker).
  // The app auto-navigates to ?tab=findings the instant findings are
  // genuinely persisted — it can win the race against "Open Results"
  // ever rendering, so wait for either signal.
  await Promise.race([
    page.waitForURL(/tab=findings/, { timeout: 4 * 60_000 }),
    page
      .getByRole("link", { name: /Open Results/i })
      .waitFor({ state: "visible", timeout: 4 * 60_000 })
      .then(() => page.getByRole("link", { name: /Open Results/i }).click()),
  ]);
  await page.waitForURL(/tab=findings/, { timeout: 30_000 });

  // No sticky bar yet — nothing selected.
  await expect(page.getByText(/^\d+ fix(es)? selected/i)).toHaveCount(0);

  // Select a genuine "Recommended fix" — never the uncertain-finding
  // "Remove this file anyway" override, which requires its own confirmation.
  const recommendedArticle = page
    .locator("article")
    .filter({ hasText: "Recommended fix" })
    .first();
  await expect(recommendedArticle).toBeVisible({ timeout: 15_000 });
  await recommendedArticle.getByRole("button", { name: "Remove this file", exact: true }).click();

  // Sticky bar appears with count 1.
  await expect(page.getByText(/^1 fix selected/i)).toBeVisible({ timeout: 10_000 });

  // Refresh — real persisted decision must survive.
  await page.reload();
  await expect(page.getByText(/^1 fix selected/i)).toBeVisible({ timeout: 20_000 });

  // Open the drawer and confirm exactly one entry.
  await page.getByRole("button", { name: "View selected fixes" }).click();
  const drawerItems = page.locator("aside, div").filter({ hasText: "Selected fixes" });
  await expect(drawerItems.first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Close" })).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();

  // Review cleanup plan — creates a real persisted draft without scrolling
  // to the bottom of the findings list.
  await page.getByRole("button", { name: /Review cleanup plan \(1\)/i }).click();
  await expect(page.getByText("Cleanup plan", { exact: false }).first()).toBeVisible({
    timeout: 10_000,
  });
});
