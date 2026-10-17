import { expect, test, type Page, type Route } from "@playwright/test";

import { getMemberCredentials, signIn } from "./helpers";

const pane = (page: Page) =>
  page.getByRole("complementary", { name: "Details" });
const status = (page: Page) => pane(page).locator('[aria-live="polite"]');
const fileRow = (page: Page, name: string) =>
  page.locator("[data-list-item]").filter({ hasText: name });
const fulfill = (route: Route, value: string, httpStatus = 200) =>
  route.fulfill({
    status: httpStatus,
    contentType: "application/json",
    body: JSON.stringify({ status: value, generatedAt: null }),
  });

async function uploadVideo(page: Page, suffix = "a") {
  const name = `preview-status-${Date.now()}-${suffix}.mp4`;
  const origin = new URL(page.url()).origin;
  const response = await page.request.post("/api/files/files", {
    headers: { origin, accept: "application/json" },
    multipart: {
      files: {
        name,
        mimeType: "video/mp4",
        buffer: Buffer.from("synthetic video status fixture"),
      },
      manifest: JSON.stringify([
        { clientKey: name, originalName: name, conflictStrategy: "fail" },
      ]),
    },
  });
  expect(response.status()).toBe(201);
  const body = await response.json();
  return { name, id: body.uploadedFiles[0].id as string };
}

async function openProperties(page: Page, name: string) {
  await page.reload();
  await fileRow(page, name).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Details", exact: true }).click();
}

test.beforeEach(async ({ page }) => {
  await signIn(page, getMemberCredentials());
});

test("open Properties follows generation and stops checking at Ready", async ({
  page,
}) => {
  const file = await uploadVideo(page);
  let queued = false;
  let activeReads = 0;
  let reads = 0;
  await page.route(
    `**/api/files/files/${file.id}/derivative`,
    async (route) => {
      if (route.request().method() === "POST") {
        queued = true;
        return fulfill(route, "queued");
      }
      reads++;
      const value = queued
        ? ["queued", "processing", "ready"][Math.min(activeReads++, 2)]
        : "none";
      return fulfill(route, value);
    },
  );
  await openProperties(page, file.name);
  await expect(status(page)).toHaveText("Not generated");
  await pane(page).getByRole("button", { name: "Generate preview" }).click();
  await expect(status(page)).toHaveText("Queued…");
  await expect(
    pane(page).getByRole("button", { name: "Generate preview" }),
  ).toBeDisabled();
  await expect(status(page)).toHaveText("Generating…", { timeout: 10_000 });
  await expect(status(page)).toHaveText("Ready", { timeout: 10_000 });
  await expect(
    pane(page).getByRole("button", { name: "Regenerate" }),
  ).toBeEnabled();
  await expect(
    pane(page).getByRole("button", { name: "Refresh status" }),
  ).toHaveCount(0);
  const finishedReads = reads;
  await page.waitForTimeout(2500);
  expect(reads).toBe(finishedReads);
});

test("an unavailable initial check recovers automatically without claiming Not generated", async ({
  page,
}) => {
  const file = await uploadVideo(page);
  let recovered = false;
  await page.route(`**/api/files/files/${file.id}/derivative`, (route) => {
    return fulfill(
      route,
      recovered ? "ready" : "invalid",
      recovered ? 200 : 503,
    );
  });
  await openProperties(page, file.name);
  await expect(status(page)).toHaveText("Unavailable");
  await expect(
    pane(page).getByRole("button", { name: "Generate preview" }),
  ).toBeDisabled();
  await expect(
    pane(page).getByText(
      "Couldn't check preview status. Checking again automatically.",
    ),
  ).toBeVisible();
  recovered = true;
  await expect(status(page)).toHaveText("Ready", { timeout: 10_000 });
  await expect(pane(page).getByRole("status")).toHaveCount(0);
  await expect(
    pane(page).getByRole("button", { name: "Regenerate" }),
  ).toBeEnabled();
});

for (const terminal of ["failed", "stale"]) {
  test(`settles ${terminal} and makes the generation action usable again`, async ({
    page,
  }) => {
    const file = await uploadVideo(page);
    let queued = false;
    let reads = 0;
    await page.route(`**/api/files/files/${file.id}/derivative`, (route) => {
      if (route.request().method() === "POST") {
        queued = true;
        return fulfill(route, "queued");
      }
      reads++;
      return fulfill(route, queued ? terminal : "none");
    });
    await openProperties(page, file.name);
    await expect(status(page)).toHaveText("Not generated");
    await pane(page).getByRole("button", { name: "Generate preview" }).click();
    await expect(status(page)).toHaveText(
      terminal === "failed" ? "Failed" : "Stale",
    );
    await expect(
      pane(page).getByRole("button", {
        name: terminal === "failed" ? "Generate preview" : "Regenerate",
      }),
    ).toBeEnabled();
    const settledReads = reads;
    await page.waitForTimeout(2500);
    expect(reads).toBe(settledReads);
  });
}

test("switching videos clears old state and ignores an old Generate response; closing aborts reads", async ({
  page,
}) => {
  const first = await uploadVideo(page, "a");
  const second = await uploadVideo(page, "b");
  let releasePost!: () => void;
  const postGate = new Promise<void>((done) => {
    releasePost = done;
  });
  let postStarted = false;
  await page.route(
    `**/api/files/files/${first.id}/derivative`,
    async (route) => {
      if (route.request().method() === "POST") {
        postStarted = true;
        await postGate;
        await fulfill(route, "processing").catch(() => {});
      } else await fulfill(route, "ready");
    },
  );
  let releaseRead!: () => void;
  const readGate = new Promise<void>((done) => {
    releaseRead = done;
  });
  let secondReads = 0;
  let secondQueued = false;
  let lateRead!: Route;
  await page.route(
    `**/api/files/files/${second.id}/derivative`,
    async (route) => {
      if (route.request().method() === "POST") {
        secondQueued = true;
        return fulfill(route, "queued");
      }
      secondReads++;
      if (!secondQueued) {
        await readGate;
        return fulfill(route, "none");
      }
      lateRead = route;
    },
  );
  await openProperties(page, first.name);
  await expect(status(page)).toHaveText("Ready");
  await pane(page).getByRole("button", { name: "Regenerate" }).click();
  await expect.poll(() => postStarted).toBe(true);
  await fileRow(page, second.name).click();
  await expect(status(page)).toHaveText("Loading…");
  await expect(
    pane(page).getByRole("button", { name: "Generate preview" }),
  ).toBeDisabled();
  releasePost();
  await expect(status(page)).toHaveText("Loading…");
  releaseRead();
  await expect(status(page)).toHaveText("Not generated");
  const initialSecondReads = secondReads;
  await pane(page).getByRole("button", { name: "Generate preview" }).click();
  await expect.poll(() => secondReads).toBeGreaterThan(initialSecondReads);
  const aborted = page.waitForEvent("requestfailed", {
    predicate: (request) => request.url().endsWith(`/${second.id}/derivative`),
  });
  await pane(page).getByRole("button", { name: "Close details" }).click();
  await aborted;
  const closedReads = secondReads;
  await fulfill(lateRead, "ready").catch(() => {});
  await expect(pane(page)).toHaveCount(0);
  await page.waitForTimeout(2500);
  expect(secondReads).toBe(closedReads);
});

test("the mobile drawer updates automatically too", async ({ page }) => {
  const file = await uploadVideo(page);
  let queued = false;
  await page.route(`**/api/files/files/${file.id}/derivative`, (route) => {
    if (route.request().method() === "POST") {
      queued = true;
      return fulfill(route, "queued");
    }
    return fulfill(route, queued ? "ready" : "none");
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await openProperties(page, file.name);
  const drawer = page.getByRole("dialog", { name: "Details" });
  await expect(drawer).toBeVisible();
  await expect(
    drawer.getByText("Not generated", { exact: true }),
  ).toBeVisible();
  await drawer.getByRole("button", { name: "Generate preview" }).click();
  await expect(drawer.getByText("Ready", { exact: true })).toBeVisible();
  await expect(
    drawer.getByRole("button", { name: "Regenerate" }),
  ).toBeEnabled();
  await expect(
    drawer.getByRole("button", { name: "Refresh status" }),
  ).toHaveCount(0);
});
