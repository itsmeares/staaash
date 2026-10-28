import { createRoute, z } from "@hono/zod-openapi";

import {
  actorOf,
  errorResponses,
  requireUser,
  router,
} from "@/server/http/core";
import { json, jsonBody, OkSchema } from "@/server/http/schemas";
import { getShareBaseUrl } from "@/server/request";
import { toManagedShareView } from "@/server/sharing/mutation-response";
import { sharingService } from "@/server/sharing/service";

const ShareSchema = z
  .object({
    id: z.string(),
    /** Only returned when the link is created or reissued; it holds the secret token. */
    shareUrl: z.string().optional(),
    hasPassword: z.boolean(),
    downloadDisabled: z.boolean(),
    expiresAt: z.string(),
    revokedAt: z.string().nullable(),
    status: z.enum(["active", "expired", "revoked"]),
  })
  .openapi("Share");

const ShareResult = json(z.object({ share: ShareSchema }), "The link.");
const ShareParams = z.object({ shareId: z.string() });
const Password = z.string().trim().min(4).max(256);

const createShare = createRoute({
  method: "post",
  path: "/api/shares",
  tags: ["Shares"],
  summary:
    "Create a public link to a file or folder, or reissue a link with a new token.",
  middleware: [requireUser],
  request: {
    body: jsonBody(
      z.union([
        z.object({ mode: z.literal("reissue"), shareId: z.string().min(1) }),
        z.object({
          mode: z.literal("create").default("create"),
          targetType: z.enum(["file", "folder"]),
          fileId: z.string().trim().min(1).optional(),
          folderId: z.string().trim().min(1).optional(),
          expiresAt: z.coerce.date().optional(),
          downloadDisabled: z.boolean().default(false),
          password: Password.optional(),
        }),
      ]),
    ),
  },
  responses: {
    200: ShareResult,
    201: ShareResult,
    ...errorResponses,
  },
});

const updateShare = createRoute({
  method: "post",
  path: "/api/shares/{shareId}/update",
  tags: ["Shares"],
  summary: "Change when a link expires and whether it allows downloads.",
  middleware: [requireUser],
  request: {
    params: ShareParams,
    body: jsonBody(
      z.object({
        expiresAt: z.coerce.date(),
        downloadDisabled: z.boolean().default(false),
      }),
    ),
  },
  responses: { 200: ShareResult, ...errorResponses },
});

const setPassword = createRoute({
  method: "post",
  path: "/api/shares/{shareId}/password",
  tags: ["Shares"],
  summary: "Set or remove a link's password.",
  middleware: [requireUser],
  request: {
    params: ShareParams,
    body: jsonBody(
      z.union([
        z.object({ password: Password }),
        z.object({ clear: z.literal(true) }),
      ]),
    ),
  },
  responses: { 200: ShareResult, ...errorResponses },
});

const revokeShare = createRoute({
  method: "post",
  path: "/api/shares/{shareId}/revoke",
  tags: ["Shares"],
  summary: "Turn a link off. It stays in the list.",
  middleware: [requireUser],
  request: { params: ShareParams },
  responses: { 200: ShareResult, ...errorResponses },
});

const deleteShare = createRoute({
  method: "post",
  path: "/api/shares/{shareId}/delete",
  tags: ["Shares"],
  summary: "Turn a link off and remove it from the list.",
  middleware: [requireUser],
  request: { params: ShareParams },
  responses: { 200: json(OkSchema, "Deleted."), ...errorResponses },
});

export const shareRoutes = router()
  .openapi(createShare, async (c) => {
    const actor = actorOf(c.var.session);
    const baseUrl = getShareBaseUrl(c.req.raw.headers);
    const body = c.req.valid("json");
    if (body.mode === "reissue") {
      const result = await sharingService.reissueShare({
        ...actor,
        shareId: body.shareId,
        baseUrl,
      });
      return c.json(
        { share: toManagedShareView(result.share, result.shareUrl) },
        200,
      );
    }
    const { mode: _mode, ...input } = body;
    const result = await sharingService.createOrReissueShare({
      ...actor,
      ...input,
      baseUrl,
    });
    return c.json(
      { share: toManagedShareView(result.share, result.shareUrl) },
      201,
    );
  })
  .openapi(updateShare, async (c) => {
    const share = await sharingService.updateShare({
      ...actorOf(c.var.session),
      shareId: c.req.valid("param").shareId,
      ...c.req.valid("json"),
    });
    return c.json({ share: toManagedShareView(share) }, 200);
  })
  .openapi(setPassword, async (c) => {
    const body = c.req.valid("json");
    const share = await sharingService.updateSharePassword({
      ...actorOf(c.var.session),
      shareId: c.req.valid("param").shareId,
      password: "password" in body ? body.password : null,
    });
    return c.json({ share: toManagedShareView(share) }, 200);
  })
  .openapi(revokeShare, async (c) => {
    const share = await sharingService.revokeShare({
      ...actorOf(c.var.session),
      shareId: c.req.valid("param").shareId,
    });
    return c.json({ share: toManagedShareView(share) }, 200);
  })
  .openapi(deleteShare, async (c) => {
    await sharingService.deleteShare({
      ...actorOf(c.var.session),
      shareId: c.req.valid("param").shareId,
    });
    return c.json({ ok: true as const }, 200);
  });
