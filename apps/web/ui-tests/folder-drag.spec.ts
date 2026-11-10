import { expect, test, type Locator, type Page } from "@playwright/test";

test.use({ reducedMotion: "reduce" });

const row = (page: Page, name: string) =>
  page.getByRole("row").filter({
    has: page.getByRole("button", { name: `Actions for ${name}`, exact: true }),
  });

async function dragOver(page: Page, source: Locator, target: Locator) {
  const start = await source.boundingBox();
  const end = await target.boundingBox();
  if (!start || !end) throw new Error("Drag item is not visible");
  await page.mouse.move(start.x + 70, start.y + 15);
  await page.mouse.down();
  await page.mouse.move(start.x + 90, start.y + 15, { steps: 5 });
  await page.mouse.move(end.x + 70, end.y + 15, { steps: 5 });
  await page.mouse.move(end.x + 72, end.y + 16);
  await expect(page.locator("[data-drag-tip]")).toBeAttached();
}

for (const view of ["grid", "list"] as const) {
  test(`rejects a folder dropped on itself in ${view} view`, async ({
    page,
  }) => {
    const moves: string[] = [];
    page.on("request", (request) => {
      if (
        request.method() === "POST" &&
        request.url().endsWith("/api/files/move")
      )
        moves.push(request.url());
    });
    await page.goto("/files");
    await page
      .getByRole("tab", { name: `${view === "grid" ? "Grid" : "List"} view` })
      .click();
    const folder = row(page, "Photo archive");
    await dragOver(page, folder, folder);
    await expect(
      page.getByText("Move to Photo archive", { exact: true }),
    ).toHaveCount(0);
    await expect(folder).not.toHaveClass(/ring-primary/);
    await page.mouse.up();
    await expect(folder).toBeVisible();
    expect(moves).toHaveLength(0);
  });

  test(`rejects a selected folder as a drop target in ${view} view`, async ({
    page,
  }) => {
    const moves: string[] = [];
    page.on("request", (request) => {
      if (
        request.method() === "POST" &&
        request.url().endsWith("/api/files/move")
      )
        moves.push(request.url());
    });
    await page.goto("/files");
    await page
      .getByRole("tab", { name: `${view === "grid" ? "Grid" : "List"} view` })
      .click();
    const folder = row(page, "Photo archive");
    const file = row(page, "Coast.jpg");
    await folder.click();
    await file.click({ modifiers: ["Control"] });
    await expect(folder).toHaveAttribute("aria-selected", "true");
    await expect(file).toHaveAttribute("aria-selected", "true");
    await dragOver(page, file, folder);
    await expect(
      page.getByText("Move to Photo archive", { exact: true }),
    ).toHaveCount(0);
    await expect(folder).not.toHaveClass(/ring-primary/);
    await page.mouse.up();
    await expect(folder).toBeVisible();
    await expect(file).toBeVisible();
    expect(moves).toHaveLength(0);
  });

  test(`moves a file to another folder in ${view} view`, async ({ page }) => {
    await page.goto("/files");
    await page
      .getByRole("tab", { name: `${view === "grid" ? "Grid" : "List"} view` })
      .click();
    const folder = row(page, "Photo archive");
    const file = row(page, "Coast.jpg");
    await dragOver(page, file, folder);
    await expect(
      page.getByText("Move to Photo archive", { exact: true }),
    ).toBeVisible();
    const request = page.waitForRequest(
      (request) =>
        request.method() === "POST" &&
        request.url().endsWith("/api/files/move"),
    );
    await page.mouse.up();
    await request;
    await expect(file).toHaveCount(0);
  });
}
