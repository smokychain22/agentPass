import { test, expect } from "@playwright/test";

/**
 * Workflow tab ownership against production.
 *
 * Regression: the Create Cleanup PR / payment panel rendered inside
 * /app?tab=findings because the workbench kept private stage state that
 * prepareAutomaticPlan() moved to "plan" without changing the URL.
 *
 * These run on a fresh session, so the earlier stages are legitimately
 * locked — which is exactly the point: payment controls must not appear
 * anywhere under tab=findings regardless of stage.
 */

const PAYMENT_CONTROLS = [
  /Approve 1 USD₮0 and create cleanup PR/i,
  /Confirm and fund 1 USD₮0 escrow/i,
  /Review 1 USD₮0 A2A task/i,
];

const EXECUTION_CONTROLS = [
  /GitHub access:/i,
  /Repository scope:/i,
  /Create cleanup pull request/i,
];

test("tab=findings never renders payment controls", async ({ page }) => {
  await page.goto("/app?tab=findings");
  await page.waitForLoadState("networkidle");
  for (const pattern of PAYMENT_CONTROLS) {
    await expect(page.getByText(pattern)).toHaveCount(0);
  }
});

test("tab=findings never renders GitHub execution controls", async ({ page }) => {
  await page.goto("/app?tab=findings");
  await page.waitForLoadState("networkidle");
  for (const pattern of EXECUTION_CONTROLS) {
    await expect(page.getByText(pattern)).toHaveCount(0);
  }
});

test("tab=verify stays locked and shows a prerequisite, never the delivery view", async ({
  page,
}) => {
  await page.goto("/app?tab=verify");
  await page.waitForLoadState("networkidle");
  await expect(page.getByText(/pull request/i).first()).toBeVisible({ timeout: 15_000 });
  for (const pattern of PAYMENT_CONTROLS) {
    await expect(page.getByText(pattern)).toHaveCount(0);
  }
});

test("navigating between tabs never creates a task or moves funds", async ({ page }) => {
  const mutations: string[] = [];
  page.on("request", (req) => {
    const url = req.url();
    if (req.method() !== "GET" && /a2a\/tasks|quote|authorize|escrow|fund/i.test(url)) {
      mutations.push(`${req.method()} ${url}`);
    }
  });
  await page.goto("/app?tab=findings");
  await page.waitForLoadState("networkidle");
  await page.goto("/app?tab=patch");
  await page.waitForLoadState("networkidle");
  expect(mutations, `unexpected money/task mutation: ${mutations.join(", ")}`).toHaveLength(0);
});
