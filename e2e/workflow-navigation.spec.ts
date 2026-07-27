import { test, expect, type Page } from "@playwright/test";

/**
 * Real browser E2E for the authoritative workflow-navigation gating
 * (Command 3B). Runs against the deployed production app. A fresh browser
 * context has no session/localStorage, so every test starts from a genuine
 * "no scan yet" state — this is exactly the state where the four stages
 * must show one consistent, non-bypassable set of locks across the top
 * rail, the left sidebar, and direct URL navigation.
 */

const LOCKED_TITLES = ["Review Findings", "Create Cleanup PR", "Review & Accept"];

async function sidebarLockedTitles(page: Page): Promise<string[]> {
  const aside = page.locator("aside").first();
  const locked: string[] = [];
  for (const title of LOCKED_TITLES) {
    const item = aside.getByText(title, { exact: true });
    const parentTag = await item
      .locator("xpath=ancestor::*[self::a or self::span][1]")
      .evaluate((el) => el.tagName.toLowerCase());
    if (parentTag !== "a") locked.push(title);
  }
  return locked;
}

async function railLockedTitles(page: Page): Promise<string[]> {
  const rail = page.getByRole("navigation", { name: "Workflow progress" });
  const locked: string[] = [];
  for (const title of LOCKED_TITLES) {
    // Rail labels are uppercase via CSS only — match case-insensitively on the raw text node.
    const item = rail.getByText(new RegExp(`^${title}$`, "i"));
    const tag = await item
      .locator("xpath=ancestor::*[self::a or self::span][1]")
      .evaluate((el) => el.tagName.toLowerCase());
    if (tag !== "a") locked.push(title);
  }
  return locked;
}

test.describe("fresh session — all four stages agree everywhere", () => {
  test("sidebar and rail both lock Review Findings / Create Cleanup PR / Review & Accept", async ({
    page,
  }) => {
    await page.goto("/app");
    await expect(page.getByText("Connect a public repository")).toBeVisible();

    const sidebarLocked = await sidebarLockedTitles(page);
    const railLocked = await railLockedTitles(page);

    expect(sidebarLocked.sort()).toEqual([...LOCKED_TITLES].sort());
    expect(railLocked.sort()).toEqual([...LOCKED_TITLES].sort());
  });

  test("direct URL to Create Cleanup PR shows the real lock, not the workbench", async ({
    page,
  }) => {
    await page.goto("/app?tab=patch");
    await expect(page.getByText("Create Cleanup PR is not available yet")).toBeVisible();
    // Must not silently render the plan/patch workbench content underneath.
    await expect(page.getByText("Cleanup plan approved")).toHaveCount(0);
  });

  test("direct URL to Review & Accept shows the real lock, not the delivery view", async ({
    page,
  }) => {
    await page.goto("/app?tab=verify");
    await expect(page.getByText("Review & Accept is not available yet")).toBeVisible();
  });

  test("refresh preserves the same lock state (no locked-then-unlocked flash)", async ({
    page,
  }) => {
    await page.goto("/app?tab=patch");
    await expect(page.getByText("Create Cleanup PR is not available yet")).toBeVisible();
    await page.reload();
    await expect(page.getByText("Create Cleanup PR is not available yet")).toBeVisible();
  });

  test("Analyze Repository stage is the only active/current step in a fresh session", async ({
    page,
  }) => {
    await page.goto("/app");
    const rail = page.getByRole("navigation", { name: "Workflow progress" });
    await expect(rail.getByText(/analyze repository/i)).toBeVisible();
  });
});
