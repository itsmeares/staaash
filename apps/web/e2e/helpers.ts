import path from "node:path";
import { readFileSync } from "node:fs";
import { expect, type Locator, type Page, test } from "@playwright/test";

type BootstrapState = {
  ownerIdentifier?: string;
  ownerPassword?: string;
  memberIdentifier?: string;
  memberPassword?: string;
  shareUrl?: string;
};

const stateFilePath = path.resolve(
  __dirname,
  "..",
  ".data",
  "e2e",
  "state.json",
);

let bootstrapState: BootstrapState | null | undefined;

const readBootstrapState = () => {
  if (bootstrapState !== undefined) {
    return bootstrapState;
  }

  try {
    bootstrapState = JSON.parse(
      readFileSync(stateFilePath, "utf8"),
    ) as BootstrapState;
  } catch {
    bootstrapState = null;
  }

  return bootstrapState;
};

const getRequiredValue = (name: string, fallback?: string) => {
  const value = process.env[name]?.trim() || fallback?.trim();
  test.skip(!value, `Missing required E2E value: ${name}`);
  return value!;
};

export const getOwnerCredentials = () => ({
  identifier: getRequiredValue(
    "STAAASH_E2E_OWNER_IDENTIFIER",
    readBootstrapState()?.ownerIdentifier,
  ),
  password: getRequiredValue(
    "STAAASH_E2E_OWNER_PASSWORD",
    readBootstrapState()?.ownerPassword,
  ),
});

export const getMemberCredentials = () => ({
  identifier: getRequiredValue(
    "STAAASH_E2E_MEMBER_IDENTIFIER",
    readBootstrapState()?.memberIdentifier,
  ),
  password: getRequiredValue(
    "STAAASH_E2E_MEMBER_PASSWORD",
    readBootstrapState()?.memberPassword,
  ),
});

export const getShareUrl = () =>
  getRequiredValue("STAAASH_E2E_SHARE_URL", readBootstrapState()?.shareUrl);

export const signIn = async (
  page: Page,
  {
    identifier,
    password,
    next = "/files",
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
