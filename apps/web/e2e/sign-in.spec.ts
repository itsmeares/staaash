import { expect, test } from "@playwright/test";

import { getMemberCredentials } from "./helpers";

test("sign-in ignores an outside return link and sign out returns to sign-in", async ({
  page,
}) => {
  const { identifier, password } = getMemberCredentials();
  await page.goto(`/?next=${encodeURIComponent("https://example.invalid/x")}`);
  const { host } = new URL(page.url());
  await page
    .getByRole("button", { name: "Click anywhere or press any key" })
    .click();
  await page.getByLabel("Email", { exact: true }).fill(identifier);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).press("Enter");
  await page.waitForURL((url) => url.host === host && url.pathname !== "/", {
    timeout: 20_000,
  });

  await page.getByRole("button", { name: "Profile menu" }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await page.waitForURL((url) => url.pathname === "/");
  await expect(
    page.getByRole("button", { name: "Click anywhere or press any key" }),
  ).toBeVisible();
});
