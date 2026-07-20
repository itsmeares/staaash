import { expect, test, type Download, type Page } from "@playwright/test";

import { getMemberCredentials, getOwnerCredentials, signIn } from "./helpers";

type ActiveFixture = {
  body: string;
  downloadDisabled: boolean;
  mimeType: string;
  name: string;
};

type UploadResponse = {
  uploadedFiles: Array<{ id: string }>;
};

type ShareResponse = {
  share: { shareUrl?: string };
};

const activeEmbedSelector = [
  'audio[src*="/content"]',
  'embed[src*="/content"]',
  'iframe[src*="/content"]',
  'img[src*="/content"]',
  'object[data*="/content"]',
  'video[src*="/content"]',
].join(", ");

const readExecutionMarkers = (page: Page) =>
  page.evaluate(() => {
    const markerWindow = window as typeof window & {
      __staaashSec01HtmlExecuted?: boolean;
      __staaashSec01SvgExecuted?: boolean;
    };
    return {
      html: markerWindow.__staaashSec01HtmlExecuted,
      svg: markerWindow.__staaashSec01SvgExecuted,
    };
  });

const expectApiSuccess = async (
  response: Awaited<ReturnType<Page["request"]["post"]>>,
) => {
  if (!response.ok()) {
    throw new Error(
      `Fixture API request failed (${response.status()}): ${await response.text()}`,
    );
  }
};

const uploadAndShareActiveFixture = async (
  page: Page,
  fixture: ActiveFixture,
) => {
  const origin = new URL(page.url()).origin;
  const uploadResponse = await page
    .context()
    .request.post(`${origin}/api/files/files`, {
      headers: {
        accept: "application/json",
        origin,
      },
      multipart: {
        files: {
          name: fixture.name,
          mimeType: fixture.mimeType,
          buffer: Buffer.from(fixture.body),
        },
        manifest: JSON.stringify([
          {
            clientKey: fixture.name,
            conflictStrategy: "fail",
            originalName: fixture.name,
          },
        ]),
      },
    });
  await expectApiSuccess(uploadResponse);

  const upload = (await uploadResponse.json()) as UploadResponse;
  const fileId = upload.uploadedFiles[0]?.id;
  if (!fileId) {
    throw new Error("Fixture upload returned no file id.");
  }

  const shareResponse = await page
    .context()
    .request.post(`${origin}/api/shares`, {
      data: {
        downloadDisabled: fixture.downloadDisabled,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        fileId,
        targetType: "file",
      },
      headers: {
        accept: "application/json",
        origin,
      },
    });
  await expectApiSuccess(shareResponse);

  const share = (await shareResponse.json()) as ShareResponse;
  if (!share.share.shareUrl) {
    throw new Error("Fixture share creation returned no public URL.");
  }

  return share.share.shareUrl;
};

const expectDirectContentDownload = async ({
  page,
  contentUrl,
  expectedFileName,
  expectedPageUrl,
}: {
  page: Page;
  contentUrl: string;
  expectedFileName: string;
  expectedPageUrl: string;
}) => {
  const downloadPromise = page.waitForEvent("download");
  await page.evaluate((href) => window.location.assign(href), contentUrl);
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toBe(expectedFileName);
  expect(page.url()).toBe(expectedPageUrl);
  expect(await readExecutionMarkers(page)).toEqual({
    html: false,
    svg: false,
  });

  await download.delete();
};

const expectDirectContentBlocked = async ({
  page,
  contentUrl,
}: {
  page: Page;
  contentUrl: string;
}) => {
  const downloads: string[] = [];
  const onDownload = (download: Download) => {
    downloads.push(download.suggestedFilename());
  };
  page.on("download", onDownload);

  try {
    const response = await page.goto(contentUrl);
    expect(response?.status()).toBe(403);
    await expect(page.locator("body")).toHaveText(
      "Downloads are disabled for this shared link.",
    );
    expect(downloads).toEqual([]);
    expect(await readExecutionMarkers(page)).toEqual({
      html: false,
      svg: false,
    });
  } finally {
    page.off("download", onDownload);
  }
};

test("public active files cannot execute on authenticated app origin", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    const markerWindow = window as typeof window & {
      __staaashSec01HtmlExecuted: boolean;
      __staaashSec01SvgExecuted: boolean;
    };
    markerWindow.__staaashSec01HtmlExecuted = false;
    markerWindow.__staaashSec01SvgExecuted = false;
  });

  await signIn(page, { ...getMemberCredentials(), next: "/files" });

  const fixtureSuffix = `${Date.now()}-${testInfo.retry}`;
  const htmlFixture = {
    body: `<!doctype html>
<meta charset="utf-8">
<title>SEC-01 inert fixture</title>
<script>
window.__staaashSec01HtmlExecuted = true;
fetch("/api/files/files?sec01-probe=html");
</script>
<p>SEC-01 inert HTML fixture</p>`,
    downloadDisabled: false,
    mimeType: "text/html",
    name: `sec01-active-${fixtureSuffix}.html`,
  } satisfies ActiveFixture;
  const svgFixture = {
    body: `<svg xmlns="http://www.w3.org/2000/svg" onload="window.__staaashSec01SvgExecuted = true">
  <text x="10" y="20">SEC-01 inert SVG fixture</text>
</svg>`,
    downloadDisabled: true,
    mimeType: "image/svg+xml",
    name: `sec01-active-${fixtureSuffix}.svg`,
  } satisfies ActiveFixture;

  const shareUrls = {
    html: await uploadAndShareActiveFixture(page, htmlFixture),
    svg: await uploadAndShareActiveFixture(page, svgFixture),
  };

  await page.context().clearCookies();
  await signIn(page, { ...getOwnerCredentials(), next: "/home" });

  const probeRequests: string[] = [];
  const authenticatedMutationRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.searchParams.has("sec01-probe")) {
      probeRequests.push(url.toString());
    }
    if (
      url.pathname.startsWith("/api/") &&
      !["GET", "HEAD", "OPTIONS"].includes(request.method())
    ) {
      authenticatedMutationRequests.push(
        `${request.method()} ${request.url()}`,
      );
    }
  });

  await page.goto(shareUrls.html);
  await expect(
    page.getByRole("heading", { name: htmlFixture.name }),
  ).toBeVisible();
  await expect(page.locator(activeEmbedSelector)).toHaveCount(0);
  await expect(page.locator("pre")).toContainText(
    "window.__staaashSec01HtmlExecuted = true;",
  );
  await expect(page.locator("pre")).toContainText(
    'fetch("/api/files/files?sec01-probe=html");',
  );
  expect(await readExecutionMarkers(page)).toEqual({ html: false, svg: false });
  expect(probeRequests).toEqual([]);

  const htmlPageUrl = page.url();
  await expectDirectContentDownload({
    page,
    contentUrl: `${htmlPageUrl}/content`,
    expectedFileName: htmlFixture.name,
    expectedPageUrl: htmlPageUrl,
  });

  await page.goto(shareUrls.svg);
  await expect(
    page.getByRole("heading", { name: svgFixture.name }),
  ).toBeVisible();
  await expect(page.locator(activeEmbedSelector)).toHaveCount(0);
  await expect(page.getByText("Downloads off")).toBeVisible();
  expect(await readExecutionMarkers(page)).toEqual({ html: false, svg: false });

  const svgPageUrl = page.url();
  await expectDirectContentBlocked({
    page,
    contentUrl: `${svgPageUrl}/content`,
  });

  expect(probeRequests).toEqual([]);
  expect(authenticatedMutationRequests).toEqual([]);

  await page.goto("/home");
  await expect(page).toHaveURL(/\/home$/u);
});
