import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

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

test("sign-in intro opens and submits with keyboard", async ({ page }) => {
  const credentials = getOwnerCredentials();

  await page.goto("/");
  await expectNoSeriousA11yViolations(page);
  await page
    .getByRole("button", { name: /Click anywhere to begin/i })
    .press("Enter");

  await expect(page.getByLabel("Username or email")).toBeFocused();
  await page.getByLabel("Username or email").fill(credentials.identifier);
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
  await page
    .getByRole("button", { name: /Click anywhere to begin/i })
    .press("Enter");
  await page.getByLabel("Username or email").fill(credentials.identifier);
  await page.getByLabel("Password").fill(credentials.password);
  await page.getByRole("button", { name: "Sign in" }).press("Enter");

  await expect(
    page.getByRole("heading", { name: "Before you dive in." }),
  ).toBeVisible();
  await expectNoSeriousA11yViolations(page);
  await page
    .getByRole("button", { name: /Click anywhere to continue/i })
    .press("Enter");

  await expect(
    page.getByRole("heading", { name: "Choose your theme" }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("radio", { name: /System/i })).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("radio", { name: /Light/i })).toBeChecked();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("radio", { name: /Dark/i })).toBeChecked();
  await page.getByRole("button", { name: "Continue" }).press("Enter");

  await expect(
    page.getByRole("heading", { name: "Set your time zone" }),
  ).toBeFocused();
  await page.getByRole("button", { name: "Continue" }).press("Enter");

  await expect(
    page.getByRole("heading", { name: "Your profile" }),
  ).toBeFocused();
  await page.getByLabel("Full name").fill("Keyboard E2E");
  await page.getByRole("button", { name: "Continue" }).press("Enter");

  await expect(
    page.getByRole("heading", { name: "Privacy & features" }),
  ).toBeFocused();
  const versionChecks = page.getByRole("switch", { name: /Version checks/i });
  await expect(versionChecks).toBeChecked();
  await versionChecks.press("Space");
  await expect(versionChecks).not.toBeChecked();
  await page.getByRole("button", { name: "Continue" }).press("Enter");

  await expect(
    page.getByRole("heading", { name: "Media previews" }),
  ).toBeFocused();
  const mediaPreviews = page.getByRole("switch", {
    name: /Enable media previews/i,
  });
  await mediaPreviews.press("Space");
  await page.getByRole("button", { name: "Enter Staaash" }).press("Enter");

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

  const list = page.locator(".explorer-list");
  const firstRow = page.locator("[data-file-row]").first();

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

  const manageButton = page.getByRole("button", { name: "Manage" }).first();
  await manageButton.press("Enter");

  const dialog = page.getByRole("dialog", { name: "Share" });
  await expect(dialog).toBeVisible();
  await expectNoSeriousA11yViolations(page, '[data-slot="dialog-content"]');

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
  await expect(manageButton).toBeFocused();
});
