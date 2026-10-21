import { expect, test } from "@playwright/test";

import { getOwnerCredentials } from "../helpers";

for (const theme of ["light", "dark"] as const) {
  for (const [name, viewport] of [
    ["desktop", { width: 1440, height: 900 }],
    ["phone", { width: 390, height: 844 }],
  ] as const) {
    test.describe(`${theme}-${name}`, () => {
      test.use({ viewport, colorScheme: theme, reducedMotion: "reduce" });

      test("sign-in, file list and settings keep their appearance", async ({
        page,
        baseURL,
      }) => {
        const label = `${theme}-${name}`;
        if (!baseURL) throw new Error("Missing Playwright baseURL.");
        await page
          .context()
          .addCookies([{ name: "staaash_theme", value: theme, url: baseURL }]);
        await page.goto("/");
        await page
          .getByRole("button", { name: "Click anywhere or press any key" })
          .click();
        await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
        await expect(page).toHaveScreenshot(`${label}-sign-in.png`, {
          animations: "disabled",
        });

        const credentials = getOwnerCredentials();
        await page
          .getByLabel("Email", { exact: true })
          .fill(credentials.identifier);
        await page.getByLabel("Password").fill(credentials.password);
        await page
          .getByRole("button", { name: "Sign in", exact: true })
          .press("Enter");
        await page.waitForURL((url) => url.pathname === "/files");
        await expect(
          page.getByText("shared-preview.png", { exact: true }).first(),
        ).toBeVisible();
        await expect(page).toHaveScreenshot(`${label}-files.png`, {
          animations: "disabled",
          mask: [
            page.getByRole("meter"),
            page.getByText(/ of [\d.]+ (GB|TB|MB)/),
            page.getByText(/just now|ago/i),
            page.getByText(/^v\d+\.\d+\.\d+/),
            page.locator("time"),
          ],
        });

        await page.goto("/admin/settings");
        await expect(
          page.getByRole("form", { name: "Drive settings" }),
        ).toBeVisible();
        await expect(page).toHaveScreenshot(`${label}-settings.png`, {
          animations: "disabled",
          mask: [
            page.getByRole("meter"),
            page.getByText(/ of [\d.]+ (GB|TB|MB)/),
            page.getByText(/^v\d+\.\d+\.\d+/),
          ],
        });
      });
    });
  }
}
