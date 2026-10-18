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
  await list.focus();
  await page.keyboard.press("Control+f");
  const find = page.getByRole("textbox", { name: "Find in this folder" });
  await find.fill("Item 105");
  await expect(page.locator(`[data-list-item="${lastId}"]`)).toBeVisible();
  await expect(list).toHaveAttribute("aria-rowcount", "2");
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
});
