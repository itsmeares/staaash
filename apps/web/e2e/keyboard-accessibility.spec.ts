import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";

import {
  getOnboardingCredentials,
  getOwnerCredentials,
  signIn,
} from "./helpers";

const axeTags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

const expectNoSeriousA11yViolations = async (
  page: Page,
  includeSelector = "main",
) => {
  const results = await new AxeBuilder({ page })
    .include(includeSelector)
    .withTags(axeTags)
    .analyze();
  const violations = results.violations.filter(
    (violation) =>
      violation.impact === "serious" || violation.impact === "critical",
  );

  expect(
    violations,
    violations
      .map(
        (violation) =>
          `${violation.id}: ${violation.description}\n${violation.nodes
            .map((node) => `  ${node.target.join(", ")}`)
            .join("\n")}`,
      )
      .join("\n\n"),
  ).toEqual([]);
};

const tabUntilFocused = async (page: Page, target: Locator, maxTabs = 6) => {
  for (let i = 0; i < maxTabs; i += 1) {
    if (await target.evaluate((node) => node === document.activeElement)) {
      return;
    }
    await page.keyboard.press("Tab");
  }

  await expect(target).toBeFocused();
};

test("sign-in intro opens and submits with keyboard", async ({ page }) => {
  const credentials = getOwnerCredentials();

  await page.goto("/");
  await expectNoSeriousA11yViolations(page);
  await expect(
    page.getByRole("button", { name: /Click anywhere or press any key/i }),
  ).not.toBeFocused();
  await page.keyboard.press("Enter");

  await expect(page.getByLabel("Email", { exact: true })).toBeFocused();
  await page.getByLabel("Email", { exact: true }).fill(credentials.identifier);
  await page.getByLabel("Password").fill(credentials.password);
  await page.getByRole("button", { name: "Sign in" }).press("Enter");

  await page.waitForURL((url) => url.pathname === "/files", {
    timeout: 20_000,
  });
});

test("incomplete-onboarding user can finish setup with keyboard", async ({
  page,
}) => {
  const credentials = getOnboardingCredentials();

  await page.goto("/");
  // Keys only advance the intro once the page is interactive.
  await page.waitForLoadState("networkidle");
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-entry-form]")).toBeVisible();
  await page.getByLabel("Email", { exact: true }).fill(credentials.identifier);
  await page.getByLabel("Password").fill(credentials.password);
  await page.getByRole("button", { name: "Sign in" }).press("Enter");

  await expect(
    page.getByRole("heading", { name: "Choose a look" }),
  ).toBeAttached({ timeout: 20_000 });
  await expectNoSeriousA11yViolations(page);
  // Arrow keys pick a half and move on.
  await page.keyboard.press("ArrowRight");

  await expect(
    page.getByRole("heading", { name: "Check your time" }),
  ).toBeAttached();
  await page.keyboard.press("Enter");

  await expect(page.getByRole("heading", { name: "Your name" })).toBeAttached();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type("Keyboard E2E");
  await page.keyboard.press("Enter");

  await expect(
    page.getByRole("heading", { name: "A few choices" }),
  ).toBeAttached();
  const versions = page.getByRole("button", { name: /Check for new versions/ });
  await tabUntilFocused(page, versions);
  await page.keyboard.press("Enter");
  await expect(versions).toHaveAccessibleName(/never/);
  await tabUntilFocused(page, page.getByRole("button", { name: "Finish" }));
  await page.keyboard.press("Enter");

  await page.waitForURL((url) => url.pathname === "/files", {
    timeout: 15_000,
  });
});

test("files rows move focus with keyboard and open selected item", async ({
  page,
}) => {
  const credentials = getOwnerCredentials();

  await signIn(page, credentials);
  await expect(page.getByText("shared-preview.png")).toBeVisible();
  await expectNoSeriousA11yViolations(page);

  const list = page.getByRole("grid");
  const firstRow = page.getByRole("grid").locator("[data-list-item]").first();

  await list.focus();
  await page.keyboard.press("ArrowDown");
  await expect(firstRow).toBeFocused();
  await expect(firstRow).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Enter");

  await page.waitForURL(/\/files\/view\/e2e-share-file/, {
    timeout: 10_000,
  });
});

test("share dialog traps focus and returns focus on Escape", async ({
  page,
}) => {
  const credentials = getOwnerCredentials();

  await signIn(page, {
    ...credentials,
    next: "/shared",
  });

  const firstRow = page.getByRole("grid").locator("[data-list-item]").first();
  await page.getByRole("grid").focus();
  await page.keyboard.press("ArrowDown");
  await expect(firstRow).toBeFocused();
  await page.keyboard.press("Enter");

  const dialog = page.getByRole("dialog", { name: "Share" });
  await expect(dialog).toBeVisible();
  await expectNoSeriousA11yViolations(page, '[data-slot="dialog-popup"]');

  await page.keyboard.press("Tab");
  await expect
    .poll(() =>
      page.evaluate(() =>
        Boolean(document.activeElement?.closest('[role="dialog"]')),
      ),
    )
    .toBe(true);
  await page.keyboard.press("Shift+Tab");
  await expect
    .poll(() =>
      page.evaluate(() =>
        Boolean(document.activeElement?.closest('[role="dialog"]')),
      ),
    )
    .toBe(true);

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(firstRow).toBeFocused();
});
