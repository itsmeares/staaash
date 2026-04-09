import { expect, type Locator, type Page, test } from "@playwright/test";

const getRequiredEnv = (name: string) => {
  const value = process.env[name]?.trim();
  test.skip(!value, `Missing required E2E environment variable: ${name}`);
  return value!;
};

export const getOwnerCredentials = () => ({
  identifier: getRequiredEnv("STAAASH_E2E_OWNER_IDENTIFIER"),
  password: getRequiredEnv("STAAASH_E2E_OWNER_PASSWORD"),
});

export const getMemberCredentials = () => ({
  identifier: getRequiredEnv("STAAASH_E2E_MEMBER_IDENTIFIER"),
  password: getRequiredEnv("STAAASH_E2E_MEMBER_PASSWORD"),
});

export const getShareUrl = () => getRequiredEnv("STAAASH_E2E_SHARE_URL");

export const signIn = async (
  page: Page,
  {
    identifier,
    password,
    next = "/library",
  }: {
    identifier: string;
    password: string;
    next?: string;
  },
) => {
  await page.goto(`/sign-in?next=${encodeURIComponent(next)}`);
  await page.getByLabel("Email or username").fill(identifier);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
};

export const expectQueuedOrRunningState = async (target: Locator) => {
  await expect(target).toContainText(/queued|running|succeeded|failed/i);
};
