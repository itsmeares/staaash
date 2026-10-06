import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { getOwnerCredentials, getShareUrl, signIn } from "./helpers";

// Whole-page color contrast, sidebar included, in both themes (#338). The
// e2e users keep the "system" theme, so the emulated color scheme picks it.
const expectReadableText = async (page: Page, label: string) => {
  const results = await new AxeBuilder({ page })
    .withRules(["color-contrast"])
    .analyze();
  const nodes = results.violations.flatMap((violation) => violation.nodes);
  expect(
    nodes.map(
      (node) => `${label}: ${node.target.join(" ")}: ${node.failureSummary}`,
    ),
  ).toEqual([]);
};

for (const colorScheme of ["light", "dark"] as const) {
  test(`text meets contrast in ${colorScheme} theme`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await signIn(page, getOwnerCredentials());

    for (const route of ["/files", "/recent", "/settings", "/admin/settings"]) {
      await page.goto(route);
      await expect(page.locator("#main-content")).toBeVisible();
      await expectReadableText(page, `${colorScheme} ${route}`);
    }

    await page.goto(getShareUrl());
    await expectReadableText(page, `${colorScheme} share`);
  });
}
