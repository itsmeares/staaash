import { expect, test } from "@playwright/test";
import { getMemberCredentials, signIn } from "./helpers";

test("find, selection, and Back cover rows beyond the first batch", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await signIn(page, getMemberCredentials());
  const origin = new URL(page.url()).origin;
  const headers = { Origin: origin, Accept: "application/json" };
  const created = await page.request.post("/api/files/folders", {
    headers,
    data: { name: `Continuous list ${Date.now()}` },
  });
  expect(created.status(), await created.text()).toBe(201);
  const { folder } = await created.json();
  const form = new FormData();
  const manifest = [];
  for (let n = 1; n <= 105; n++) {
    const name = `Item ${String(n).padStart(3, "0")}.txt`;
    manifest.push({ clientKey: String(n), originalName: name });
    form.append("files", new File([`File ${n}`], name, { type: "text/plain" }));
  }
  form.append("manifest", JSON.stringify(manifest));
  form.append("folderId", folder.id);
  const upload = await page.request.post("/api/files/files", {
    headers,
    multipart: form,
    timeout: 120_000,
  });
  expect(upload.status(), await upload.text()).toBe(201);
  const uploaded = (await upload.json()).uploadedFiles;
  const lastId = uploaded.find(
    (file: { name: string }) => file.name === "Item 105.txt",
  ).id;
  const route = `/files/f/${folder.id}`;
  await page.goto(route);
  const list = page.locator("[data-file-list]");
  await expect(list).toHaveAttribute("aria-rowcount", "106");
  await expect
    .poll(() => page.locator("[data-list-item]").count())
    .toBeLessThan(105);
  await page.getByRole("button", { name: "Details", exact: true }).click();
  await expect(
    page
      .getByLabel("Details", { exact: true })
      .getByText("105 files", { exact: true }),
  ).toBeVisible();
  await list.focus();
  await page.keyboard.press("Control+f");
  const find = page.getByRole("textbox", { name: "Find in this folder" });
  await find.fill("Item 105");
  await expect(page.locator(`[data-list-item="${lastId}"]`)).toBeVisible();
  await expect(list).toHaveAttribute("aria-rowcount", "2");
  await expect(
    page
      .getByLabel("Details", { exact: true })
      .getByText("105 files", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Close details", exact: true })
    .click();
  await find.fill("No matching file");
  await expect(
    page.getByText("Nothing matches", { exact: true }),
  ).toBeVisible();
  await find.press("Escape");
  await expect(list).toBeFocused();
  await expect(list).toHaveAttribute("aria-rowcount", "106");
  await list.focus();
  await page.keyboard.press("Control+a");
  await expect(
    page
      .getByRole("toolbar", { name: "Selection", exact: true })
      .getByText("105 selected", { exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Home");
  await page.keyboard.press("Shift+End");
  await expect(
    page
      .getByRole("toolbar", { name: "Selection", exact: true })
      .getByText("105 selected", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(`[data-list-item="${lastId}"]`)).toBeFocused();
  await expect(page.locator(`[data-list-item="${lastId}"]`)).toHaveAttribute(
    "aria-rowindex",
    "106",
  );
  const main = page.locator("main[data-workspace-content]");
  const top = await main.evaluate((element) => element.scrollTop);
  expect(top).toBeGreaterThan(3000);
  await page
    .getByRole("navigation", { name: "Drive", exact: true })
    .getByRole("link", { name: "Home", exact: true })
    .click();
  await expect(page).toHaveURL(/\/home$/, { timeout: 20_000 });
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`${route}$`), { timeout: 20_000 });
  await expect
    .poll(() => main.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(top - 150);
  await expect(page.locator(`[data-list-item="${lastId}"]`)).toBeVisible();
  await page.getByRole("tab", { name: "Grid view", exact: true }).click();
  await main.evaluate((element) => {
    element.scrollTop = 1200;
  });
  await expect
    .poll(() =>
      page.locator("[data-list-item]").evaluateAll((items) => {
        const cells = items.map((item) => ({
          index: Number(item.getAttribute("aria-rowindex")) - 1,
          box: item.getBoundingClientRect(),
        }));
        const first = cells.find((cell) => cell.index === 0);
        if (!first || cells.length < 43) return false;
        const row = cells.filter(
          (cell) => Math.abs(cell.box.top - first.box.top) < 1,
        );
        if (row.length < 2) return false;
        const step = row[1]!.box.left - first.box.left;
        return cells.every(
          (cell) =>
            Math.abs(
              cell.box.left - first.box.left - (cell.index % row.length) * step,
            ) < 1,
        );
      }),
    )
    .toBe(true);
  await page.getByRole("tab", { name: "List view", exact: true }).click();
  await page.goto(`${route}?viewer-check`);
  await page.locator("[data-list-item]").first().dblclick();
  for (let n = 0; n < 100; n++) {
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(
      page.getByRole("dialog", {
        name: `Item ${String(n + 2).padStart(3, "0")}.txt`,
        exact: true,
      }),
    ).toBeVisible();
  }
  const nextId = uploaded.find(
    (file: { name: string }) => file.name === "Item 101.txt",
  ).id;
  await expect(page).toHaveURL(new RegExp(`/files/view/${nextId}$`));
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.locator(`[data-list-item="${nextId}"]`)).toBeFocused();
  await page.setViewportSize({ width: 3440, height: 1440 });
  await page.goto(`/files/view/${uploaded[0].id}`);
  const strip = page.getByLabel("Files in this folder", { exact: true });
  await expect(strip).toBeVisible();
  await expect(
    strip.getByRole("button", { name: /^Loading file/ }),
  ).toHaveCount(0);
  let reads = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.headers()["next-action"])
      reads++;
  });
  await strip.evaluate((element) => {
    element.scrollLeft = 3000;
  });
  await expect(
    strip.getByRole("button", { name: "Item 090.txt", exact: true }),
  ).toBeEnabled();
  await expect(
    strip.getByRole("button", { name: /^Loading file/ }),
  ).toHaveCount(0);
  const settled = reads;
  await strip.evaluate((element) => {
    element.scrollLeft += 70;
  });
  await expect(
    strip.getByRole("button", { name: "Item 040.txt", exact: true }),
  ).toHaveCount(0);
  await expect(
    strip.getByRole("button", { name: /^Loading file/ }),
  ).toHaveCount(0);
  await page.waitForTimeout(500);
  expect(reads).toBe(settled);
});

test("Empty trash stays available when a filter hides the trashed items", async ({
  page,
}) => {
  await signIn(page, getMemberCredentials());
  const headers = {
    Origin: new URL(page.url()).origin,
    Accept: "application/json",
  };
  const created = await page.request.post("/api/files/folders", {
    headers,
    data: { name: `Trash action ${Date.now()}` },
  });
  expect(created.status()).toBe(201);
  const { folder } = await created.json();
  const trashed = await page.request.post(
    `/api/files/folders/${folder.id}/trash`,
    { headers, data: {} },
  );
  expect(trashed.ok()).toBe(true);
  try {
    await page.goto("/trash");
    const empty = page.getByRole("button", {
      name: "Empty trash",
      exact: true,
    });
    await expect(empty).toBeEnabled();
    await page.getByRole("button", { name: "Type", exact: true }).click();
    await page
      .getByRole("menuitemradio", { name: "Images", exact: true })
      .click();
    await expect(empty).toBeEnabled();
  } finally {
    const restored = await page.request.post(
      `/api/files/folders/${folder.id}/restore`,
      { headers, data: {} },
    );
    expect(restored.ok()).toBe(true);
  }
});

test("failed bulk link loading shows an error while the list is collapsed", async ({
  page,
}) => {
  await signIn(page, getMemberCredentials());
  const headers = {
    Origin: new URL(page.url()).origin,
    Accept: "application/json",
  };
  const created = await page.request.post("/api/files/folders", {
    headers,
    data: { name: `Link error ${Date.now()}` },
  });
  expect(created.status()).toBe(201);
  const { folder } = await created.json();
  const shared = await page.request.post("/api/shares", {
    headers,
    data: {
      targetType: "folder",
      folderId: folder.id,
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    },
  });
  expect(shared.ok()).toBe(true);
  const { share } = await shared.json();
  expect(
    (
      await page.request.post(`/api/shares/${share.id}/revoke`, {
        headers,
        data: {},
      })
    ).ok(),
  ).toBe(true);
  await page.goto("/shared");
  await page.getByRole("button", { name: "Delete all", exact: true }).click();
  await page.route("**/shared", async (route) => {
    if (route.request().headers()["next-action"]) await route.abort("failed");
    else await route.continue();
  });
  await page
    .getByRole("dialog", { name: /Delete .* turned off links/ })
    .getByRole("button", { name: "Delete all", exact: true })
    .click();
  await expect(
    page
      .locator('[data-slot="toast-title"]')
      .filter({ hasText: /Failed to fetch|could not load|Load failed/ }),
  ).toBeVisible();
});
