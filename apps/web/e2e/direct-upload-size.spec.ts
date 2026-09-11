import { expect, test } from "@playwright/test";

import { getMemberCredentials, signIn } from "./helpers";

test("uploads a multipart file above Next's default proxy body limit", async ({
  page,
}) => {
  await signIn(page, getMemberCredentials());

  const origin = new URL(page.url()).origin;
  const name = `direct-upload-${Date.now()}.bin`;
  const response = await page
    .context()
    .request.post(`${origin}/api/files/files`, {
      headers: {
        accept: "application/json",
        origin,
      },
      multipart: {
        files: {
          name,
          mimeType: "application/octet-stream",
          buffer: Buffer.alloc(11 * 1024 * 1024, 0x5a),
        },
        manifest: JSON.stringify([
          {
            clientKey: name,
            conflictStrategy: "fail",
            originalName: name,
          },
        ]),
      },
    });

  expect(response.status()).toBe(201);
  const result = (await response.json()) as {
    uploadedFiles?: Array<{ id?: string }>;
  };
  expect(result.uploadedFiles?.[0]?.id).toBeTruthy();
});
