import { cookies } from "next/headers";

import { createShareErrorResponse } from "@/app/s/share-response";
import { SHARE_ACCESS_COOKIE_NAME } from "@/server/sharing/access-cookie";
import { sharingService } from "@/server/sharing/service";
import { StorageEntityUnavailableError } from "@/server/storage-read-guard";

const unavailableHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Storage operation finishing</title>
  </head>
  <body>
    <main>
      <h1>Storage operation finishing</h1>
      <p>This shared item is unavailable until storage recovery finishes.</p>
    </main>
</body>
</html>`;

const revalidateSharedStorage = async ({
  token,
  fileId,
  folderId,
  shareAccessCookieValue,
}: {
  token: string;
  fileId: string | null;
  folderId: string | null;
  shareAccessCookieValue: string | null;
}) => {
  if (fileId) {
    await sharingService.getSharedNestedFileContent({
      token,
      fileId,
      shareAccessCookieValue,
    });
    return;
  }
  await sharingService.resolvePublicShare({
    token,
    requestedFolderId: folderId ?? undefined,
    shareAccessCookieValue,
  });
};

const storageRecoveryResponse = (error: StorageEntityUnavailableError) =>
  new Response(unavailableHtml, {
    status: 503,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "retry-after": "10",
      "X-Storage-Mutation-Id": error.mutationId,
    },
  });

const storageRevalidationErrorResponse = (error: unknown) =>
  error instanceof StorageEntityUnavailableError
    ? storageRecoveryResponse(error)
    : createShareErrorResponse(error);

const safeShareReturnDestination = (token: string, returnTo: string | null) => {
  const safePrefix = `/s/${encodeURIComponent(token)}`;
  return returnTo?.startsWith(safePrefix) && !returnTo.startsWith("//")
    ? returnTo
    : safePrefix;
};

export async function GET(
  request: Request,
  context: { params: Promise<{ token: string }> },
) {
  const { token } = await context.params;
  const url = new URL(request.url);
  const fileId = url.searchParams.get("fileId");
  const folderId = url.searchParams.get("folderId");
  const returnTo = url.searchParams.get("returnTo");
  const cookieStore = await cookies();
  const shareAccessCookieValue =
    cookieStore.get(SHARE_ACCESS_COOKIE_NAME)?.value ?? null;

  try {
    await revalidateSharedStorage({
      token,
      fileId,
      folderId,
      shareAccessCookieValue,
    });
  } catch (error) {
    return storageRevalidationErrorResponse(error);
  }

  const destination = safeShareReturnDestination(token, returnTo);
  return Response.redirect(new URL(destination, request.url), 307);
}
