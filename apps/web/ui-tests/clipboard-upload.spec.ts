import { expect, test, type Page } from "@playwright/test";

const pasteFiles = (
  page: Page,
  files = [
    { name: "Pasted.txt", type: "text/plain", contents: "Clipboard bytes" },
  ],
  selector = "body",
) =>
  page.locator(selector).evaluate((target, files) => {
    const data = new DataTransfer();
    for (const file of files) {
      data.items.add(new File([file.contents], file.name, { type: file.type }));
    }
    const event = new ClipboardEvent("paste", {
      clipboardData: data,
      bubbles: true,
      cancelable: true,
    });
    target.dispatchEvent(event);
    return event.defaultPrevented;
  }, files);

test.describe("clipboard uploads", { tag: "@smoke" }, () => {
  test("uploads a native clipboard image even with pending cut items", async ({
    page,
  }) => {
    await page
      .context()
      .grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("/files");
    await page
      .getByRole("button", { name: "Actions for Coast.jpg", exact: true })
      .click();
    await page.getByRole("menuitem", { name: "Cut", exact: true }).click();
    await page.goto("/files/f/owner-documents");
    await expect(
      page.getByRole("grid", { name: "Documents files", exact: true }),
    ).toBeVisible();
    await page.evaluate(async () => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 8;
      const context = canvas.getContext("2d")!;
      context.fillStyle = "#58a6ff";
      context.fillRect(0, 0, 8, 8);
      const image = await new Promise<Blob>((resolve) =>
        canvas.toBlob((blob) => resolve(blob!)),
      );
      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": image }),
      ]);
      document.addEventListener(
        "paste",
        (event) => {
          document.body.dataset.pasteTrusted = String(event.isTrusted);
        },
        { once: true },
      );
    });
    await page
      .getByRole("grid", { name: "Documents files", exact: true })
      .focus();
    const uploaded = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/files/files") &&
        response.request().method() === "POST",
    );
    await page.keyboard.press("Control+v");
    expect((await uploaded).status()).toBe(201);
    await expect(page.locator("body")).toHaveAttribute(
      "data-paste-trusted",
      "true",
    );
    await expect(
      page.getByRole("button", { name: /^Actions for Pasted image .*\.png$/ }),
    ).toHaveCount(1);
    await expect(
      page.getByRole("toolbar", { name: "Cut items" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Actions for Coast.jpg", exact: true }),
    ).toHaveCount(0);
  });

  test("uploads mixed files into an empty folder and preserves their bytes", async ({
    page,
  }) => {
    await page.goto("/files/f/owner-empty");
    await expect(
      page.getByText("This folder is empty", { exact: true }),
    ).toBeVisible();
    expect(
      await pasteFiles(page, [
        {
          name: "Report.pdf",
          type: "application/pdf",
          contents: "%PDF-clipboard",
        },
        { name: "Notes.txt", type: "text/plain", contents: "Clipboard café" },
      ]),
    ).toBe(true);
    await expect(
      page.getByRole("button", { name: "Actions for Report.pdf", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Actions for Notes.txt", exact: true }),
    ).toBeVisible();
    await page.reload();
    await page
      .getByRole("button", { name: "Actions for Notes.txt", exact: true })
      .click();
    const pendingDownload = page.waitForEvent("download");
    await page.getByRole("menuitem", { name: "Download", exact: true }).click();
    const download = await pendingDownload;
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks).toString()).toBe("Clipboard café");
  });

  test("keeps the paste destination when the user changes folders during upload", async ({
    page,
  }) => {
    let finishUpload = () => {};
    const release = new Promise<void>((resolve) => {
      finishUpload = resolve;
    });
    await page.route("**/api/files/files", async (route) => {
      await release;
      await route.continue();
    });
    await page.goto("/files/f/owner-empty");
    await expect(
      page.getByText("This folder is empty", { exact: true }),
    ).toBeVisible();
    const uploadStarted = page.waitForRequest((request) =>
      request.url().endsWith("/api/files/files"),
    );
    await pasteFiles(page);
    await uploadStarted;
    await page
      .getByRole("navigation", { name: "Drive", exact: true })
      .getByRole("link", { name: "Files", exact: true })
      .click();
    const uploaded = page.waitForResponse((response) =>
      response.url().endsWith("/api/files/files"),
    );
    finishUpload();
    expect((await uploaded).status()).toBe(201);
    await expect(
      page.getByRole("button", { name: "Actions for Pasted.txt", exact: true }),
    ).toHaveCount(0);
    await page.getByRole("row").filter({ hasText: "Empty folder" }).dblclick();
    await expect(
      page.getByRole("button", { name: "Actions for Pasted.txt", exact: true }),
    ).toBeVisible();
  });

  test("keeps pasting while an upload notification is visible", async ({
    page,
  }) => {
    await page.goto("/files/f/owner-empty");
    await expect(
      page.getByText("This folder is empty", { exact: true }),
    ).toBeVisible();
    await pasteFiles(page);
    await expect(
      page.getByRole("button", { name: "Actions for Pasted.txt", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("dialog").filter({ hasText: "1 file uploaded" }),
    ).toBeVisible();
    expect(
      await pasteFiles(page, [
        { name: "Second.txt", type: "text/plain", contents: "Second paste" },
      ]),
    ).toBe(true);
    await expect(
      page.getByRole("button", { name: "Actions for Second.txt", exact: true }),
    ).toBeVisible();
  });

  test("leaves text fields, menus, dialogs, and the file viewer alone", async ({
    page,
  }) => {
    await page.goto("/files");
    await expect(
      page.getByRole("grid", { name: "Files files", exact: true }),
    ).toBeVisible();
    expect(await pasteFiles(page, undefined, "#workspace-search")).toBe(false);
    await page
      .getByRole("button", { name: "Actions for Coast.jpg", exact: true })
      .click();
    expect(await pasteFiles(page)).toBe(false);
    await page.getByRole("menuitem", { name: "Rename", exact: true }).click();
    expect(
      await pasteFiles(page, undefined, 'input[aria-label="Rename Coast.jpg"]'),
    ).toBe(false);
    await page.keyboard.press("Escape");
    await page
      .getByRole("button", { name: "Actions for Coast.jpg", exact: true })
      .click();
    await page
      .getByRole("menuitem", { name: "Manage link", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toBeVisible();
    expect(await pasteFiles(page)).toBe(false);
    await page.keyboard.press("Escape");
    await page.getByRole("row").filter({ hasText: "Coast.jpg" }).dblclick();
    await expect(page.getByRole("dialog")).toBeVisible();
    expect(await pasteFiles(page)).toBe(false);
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("button", { name: "Actions for Pasted.txt", exact: true }),
    ).toHaveCount(0);
  });

  test("leaves editable descendants and plain text paste alone", async ({
    page,
  }) => {
    await page.goto("/files");
    await expect(
      page.getByRole("grid", { name: "Files files", exact: true }),
    ).toBeVisible();
    await page.evaluate(() => {
      const editor = document.createElement("div");
      editor.contentEditable = "true";
      editor.innerHTML = '<span id="paste-editor">Editable</span>';
      document.body.append(editor);
    });
    expect(await pasteFiles(page, undefined, "#paste-editor")).toBe(false);
    const prevented = await page.evaluate(() => {
      const data = new DataTransfer();
      data.setData("text/plain", "https://example.com/file.png");
      const event = new ClipboardEvent("paste", {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      });
      document.body.dispatchEvent(event);
      return event.defaultPrevented;
    });
    expect(prevented).toBe(false);
    await expect(
      page.getByRole("button", { name: "Actions for Pasted.txt", exact: true }),
    ).toHaveCount(0);
  });

  test("moves cut items through the paste event when no clipboard files are present", async ({
    page,
  }) => {
    await page.goto("/files");
    await page
      .getByRole("button", { name: "Actions for Coast.jpg", exact: true })
      .click();
    await page.getByRole("menuitem", { name: "Cut", exact: true }).click();
    await page.goto("/files/f/owner-empty");
    await expect(
      page.getByRole("toolbar", { name: "Cut items" }),
    ).toBeVisible();
    expect(await pasteFiles(page, [])).toBe(true);
    await expect(
      page.getByRole("button", { name: "Actions for Coast.jpg", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("toolbar", { name: "Cut items" })).toHaveCount(
      0,
    );
  });

  test("does not move cut items when clipboard files cannot be read", async ({
    page,
  }) => {
    await page.goto("/files");
    await page
      .getByRole("button", { name: "Actions for Coast.jpg", exact: true })
      .click();
    await page.getByRole("menuitem", { name: "Cut", exact: true }).click();
    await page.goto("/files/f/owner-empty");
    await expect(
      page.getByRole("toolbar", { name: "Cut items" }),
    ).toBeVisible();
    await page.evaluate(() => {
      const data = new DataTransfer();
      Object.defineProperty(data, "types", { value: ["Files"] });
      document.body.dispatchEvent(
        new ClipboardEvent("paste", {
          clipboardData: data,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    await expect(
      page.getByText(
        "The clipboard files could not be read. Use Upload or drag and drop.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      page.getByRole("toolbar", { name: "Cut items" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Actions for Coast.jpg", exact: true }),
    ).toHaveCount(0);
  });

  test("removes the upload listener on other workspace and public pages", async ({
    page,
  }) => {
    await page.goto("/files");
    await expect(
      page.getByRole("grid", { name: "Files files", exact: true }),
    ).toBeVisible();
    await page.getByRole("link", { name: "Home", exact: true }).click();
    await expect(page).toHaveURL(/\/home$/);
    expect(await pasteFiles(page)).toBe(false);
    await page.goto("/s/owner-folder");
    await expect(page.locator("main")).toBeVisible();
    expect(await pasteFiles(page)).toBe(false);
  });
});
