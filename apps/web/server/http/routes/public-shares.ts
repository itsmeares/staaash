import { unavailableHtml } from "@/server/sharing/unavailable-page";
import { createRoute, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { getCookie } from "hono/cookie";

import {
  applyCookie,
  errorResponses,
  jsonError,
  router,
} from "@/server/http/core";
import { json, jsonBody, OkSchema } from "@/server/http/schemas";
import {
  createMediaErrorResponse,
  MediaContentError,
} from "@/server/media/content-response";
import {
  buildShareAccessCookie,
  SHARE_ACCESS_COOKIE_NAME,
} from "@/server/sharing/access-cookie";
import {
  createArchiveResponse,
  createFileDownloadResponse,
  createPosterErrorResponse,
  createPublicShareContentRouteResponse,
  createSharePosterResponse,
  createShareErrorResponse,
  createShareThumbnailResponse,
} from "@/server/sharing/public-responses";
import { sharingService } from "@/server/sharing/service";
import { StorageEntityUnavailableError } from "@/server/storage-read-guard";

const TokenParams = z.object({ token: z.string() });
const FileParams = TokenParams.extend({ fileId: z.string() });

const accessCookie = (c: Context) =>
  getCookie(c, SHARE_ACCESS_COOKIE_NAME) ?? null;

const bytes = <const Path extends string, Params extends z.ZodObject>(
  path: Path,
  params: Params,
  summary: string,
) =>
  createRoute({
    method: "get",
    path,
    tags: ["Public links"],
    summary,
    request: { params },
    responses: {
      200: { description: "The bytes." },
      307: { description: "Go to the content." },
      404: { description: "Unavailable." },
    },
  });

const content = bytes(
  "/s/{token}/content",
  TokenParams,
  "A shared file inline. Supports Range.",
);
const nestedContent = bytes(
  "/s/{token}/files/{fileId}/content",
  FileParams,
  "A file in a shared folder, inline. Supports Range.",
);
const download = bytes(
  "/s/{token}/download",
  TokenParams,
  "Download a shared file. Supports Range.",
);
const nestedDownload = bytes(
  "/s/{token}/files/{fileId}/download",
  FileParams,
  "Download a file in a shared folder. Supports Range.",
);
const archive = bytes(
  "/s/{token}/archive",
  TokenParams,
  "Download a shared folder as a zip.",
);
const poster = bytes(
  "/s/{token}/poster",
  TokenParams,
  "A shared video's poster image.",
);
const nestedPoster = bytes(
  "/s/{token}/files/{fileId}/poster",
  FileParams,
  "The poster image of a video in a shared folder.",
);
const preview = bytes(
  "/s/{token}/preview",
  TokenParams,
  "Redirects to the content when the browser can show it.",
);
const nestedPreview = bytes(
  "/s/{token}/files/{fileId}/preview",
  FileParams,
  "Redirects to the content when the browser can show it.",
);
const thumbnail = bytes(
  "/s/{token}/files/{fileId}/thumbnail",
  FileParams,
  "A ready thumbnail of a file in a shared folder.",
);

const unlock = createRoute({
  method: "post",
  path: "/s/{token}/unlock",
  tags: ["Public links"],
  summary: "Enter a link's password. Sets a cookie for this link only.",
  request: {
    params: TokenParams,
    body: jsonBody(z.object({ password: z.string().trim().min(1).max(256) })),
  },
  responses: { 200: json(OkSchema, "Unlocked."), ...errorResponses },
});

const storageUnavailable = createRoute({
  method: "get",
  path: "/s/{token}/storage-unavailable",
  tags: ["Public links"],
  summary:
    "Checks again whether a shared item is readable, then sends the visitor back.",
  request: {
    params: TokenParams,
    query: z.object({
      fileId: z.string().optional(),
      folderId: z.string().optional(),
      returnTo: z.string().optional(),
    }),
  },
  responses: {
    307: { description: "Readable again." },
    503: { description: "Still finishing a storage change." },
  },
});

const notPreviewable = () =>
  new Response("Preview not supported for this file type.", {
    status: 404,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });

/** Posters and thumbnails hide why they are missing. */
const imageError = (error: unknown) => {
  if (error instanceof StorageEntityUnavailableError) {
    return Response.json(
      { error: error.message, code: error.code },
      {
        status: error.status,
        headers: { "X-Storage-Mutation-Id": error.mutationId },
      },
    );
  }
  if (error instanceof MediaContentError)
    return createMediaErrorResponse(error);
  return createPosterErrorResponse();
};

const routes = router()
  .openapi(content, (c) =>
    createPublicShareContentRouteResponse({
      request: c.req.raw,
      token: c.req.valid("param").token,
      shareAccessCookieValue: accessCookie(c),
    }),
  )
  .openapi(nestedContent, (c) =>
    createPublicShareContentRouteResponse({
      request: c.req.raw,
      ...c.req.valid("param"),
      shareAccessCookieValue: accessCookie(c),
    }),
  )
  .openapi(download, async (c) =>
    createFileDownloadResponse(
      await sharingService.getSharedFileDownload({
        token: c.req.valid("param").token,
        shareAccessCookieValue: accessCookie(c),
      }),
      c.req.raw,
    ),
  )
  .openapi(nestedDownload, async (c) =>
    createFileDownloadResponse(
      await sharingService.getSharedNestedFileDownload({
        ...c.req.valid("param"),
        shareAccessCookieValue: accessCookie(c),
      }),
      c.req.raw,
    ),
  )
  .openapi(archive, async (c) =>
    createArchiveResponse(
      await sharingService.createFolderArchive({
        token: c.req.valid("param").token,
        shareAccessCookieValue: accessCookie(c),
      }),
      c.req.raw.signal,
    ),
  )
  .openapi(poster, (c) =>
    createSharePosterResponse({
      request: c.req.raw,
      token: c.req.valid("param").token,
      shareAccessCookieValue: accessCookie(c),
    }).catch(imageError),
  )
  .openapi(nestedPoster, (c) =>
    createSharePosterResponse({
      request: c.req.raw,
      ...c.req.valid("param"),
      shareAccessCookieValue: accessCookie(c),
    }).catch(imageError),
  )
  .openapi(thumbnail, (c) =>
    createShareThumbnailResponse({
      request: c.req.raw,
      ...c.req.valid("param"),
      shareAccessCookieValue: accessCookie(c),
    }).catch(imageError),
  )
  .openapi(preview, async (c) => {
    const { token } = c.req.valid("param");
    const { file } = await sharingService.getSharedFileContent({
      token,
      shareAccessCookieValue: accessCookie(c),
    });
    if (!file.viewerKind) return notPreviewable();
    return c.redirect(`/s/${encodeURIComponent(token)}/content`, 307);
  })
  .openapi(nestedPreview, async (c) => {
    const { token, fileId } = c.req.valid("param");
    const { file } = await sharingService.getSharedNestedFileContent({
      token,
      fileId,
      shareAccessCookieValue: accessCookie(c),
    });
    if (!file.viewerKind) return notPreviewable();
    return c.redirect(
      `/s/${encodeURIComponent(token)}/files/${fileId}/content`,
      307,
    );
  })
  .openapi(unlock, async (c) => {
    const { token } = c.req.valid("param");
    const result = await sharingService.unlockShare({
      token,
      password: c.req.valid("json").password,
    });
    applyCookie(
      c,
      buildShareAccessCookie(
        {
          shareId: result.share.id,
          tokenLookupKey: result.share.tokenLookupKey,
          accessFingerprint: result.accessFingerprint,
          token,
        },
        c.req.raw,
      ),
    );
    return c.json({ ok: true as const }, 200);
  })
  .openapi(storageUnavailable, async (c) => {
    const { token } = c.req.valid("param");
    const { fileId, folderId, returnTo } = c.req.valid("query");
    const shareAccessCookieValue = accessCookie(c);
    try {
      if (fileId) {
        await sharingService.getSharedNestedFileContent({
          token,
          fileId,
          shareAccessCookieValue,
        });
      } else {
        await sharingService.resolvePublicShare({
          token,
          requestedFolderId: folderId,
          shareAccessCookieValue,
        });
      }
    } catch (error) {
      if (!(error instanceof StorageEntityUnavailableError)) throw error;
      return new Response(unavailableHtml, {
        status: 503,
        headers: {
          "content-type": "text/html; charset=utf-8",
          "retry-after": "10",
          "X-Storage-Mutation-Id": error.mutationId,
        },
      });
    }
    const safePrefix = `/s/${encodeURIComponent(token)}`;
    return c.redirect(
      returnTo?.startsWith(safePrefix) && !returnTo.startsWith("//")
        ? returnTo
        : safePrefix,
      307,
    );
  });

// Visitors open these links in the browser, so errors are plain text. Unlock
// is called from the page and answers JSON like the rest of the API.
routes.onError((error, c) =>
  c.req.path.endsWith("/unlock")
    ? jsonError(error)
    : error instanceof MediaContentError
      ? createMediaErrorResponse(error)
      : createShareErrorResponse(error),
);

export const publicShareRoutes = routes;
