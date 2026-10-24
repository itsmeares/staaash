import { createRoute, z } from "@hono/zod-openapi";
import { getPrisma, type Prisma } from "@staaash/db/client";
import {
  currentStorageChangeCursor,
  readStorageChanges,
  readStorageSnapshotPage,
  StorageChangesExpiredError,
} from "@staaash/db/storage-changes";
import { streamSSE } from "hono/streaming";

import { resolveAppVersion } from "@/server/app-version";
import { filesService } from "@/server/files/service";
import {
  actorOf,
  errorResponses,
  httpError,
  requireUser,
  router,
  storageMutation,
} from "@/server/http/core";
import { FileMutationSchema, json, jsonBody } from "@/server/http/schemas";
import { subscribeLiveEvents } from "@/server/live-events";

/** The oldest desktop app this server still speaks to. */
const MIN_CLIENT_VERSION = "2.0.0";
const HEARTBEAT_MS = 25_000;

const Cursor = z
  .string()
  .regex(/^\d{1,19}$/, "A cursor is a whole number.")
  .openapi({
    description: "An opaque, increasing position in the change log.",
  });

const ItemType = z.enum(["folder", "file"]);

const ChangeSchema = z
  .object({
    seq: Cursor,
    kind: z.enum([
      "created",
      "updated",
      "moved",
      "trashed",
      "restored",
      "deleted",
    ]),
    itemType: ItemType,
    itemId: z.string(),
    parentId: z.string().nullable(),
    previousParentId: z.string().nullable(),
    path: z
      .string()
      .openapi({ description: "Below the files root, `/`-separated." }),
    previousPath: z.string().nullable(),
    name: z.string(),
    sizeBytes: z.number().int().nullable(),
    contentChecksum: z.string().nullable(),
    storageRevision: z.number().int(),
    clientModifiedAt: z.date().nullable(),
    originDeviceId: z.string().nullable().openapi({
      description:
        "The device session that made the change, so it can skip its own echo.",
    }),
    createdAt: z.date(),
  })
  .openapi("StorageChange");

const SnapshotItemSchema = z
  .object({
    type: ItemType,
    id: z.string(),
    parentId: z.string().nullable(),
    name: z.string(),
    path: z.string(),
    sizeBytes: z.number().int().nullable(),
    contentChecksum: z.string().nullable(),
    storageRevision: z.number().int(),
    clientModifiedAt: z.date().nullable(),
    updatedAt: z.date(),
  })
  .openapi("SnapshotItem");

const version = createRoute({
  method: "get",
  path: "/api/version",
  tags: ["Sync"],
  summary: "The server version and the oldest desktop app it supports.",
  responses: {
    200: json(
      z.object({ version: z.string(), minClientVersion: z.string() }),
      "Versions.",
    ),
  },
});

const changes = createRoute({
  method: "get",
  path: "/api/sync/changes",
  tags: ["Sync"],
  summary:
    "Your changes after a cursor, oldest first. Keep the returned cursor; call again while hasMore is true.",
  middleware: [requireUser],
  request: {
    query: z.object({
      after: Cursor,
      limit: z.coerce.number().int().min(1).max(1000).default(500),
    }),
  },
  responses: {
    200: json(
      z.object({
        changes: z.array(ChangeSchema),
        cursor: Cursor,
        hasMore: z.boolean(),
      }),
      "Changes.",
    ),
    410: json(
      z.object({ error: z.string(), code: z.literal("CHANGES_EXPIRED") }),
      "The log no longer reaches back this far (90 days). Take a new snapshot.",
    ),
    ...errorResponses,
  },
});

const SnapshotCursor = z
  .string()
  .regex(/^(folder|file):.+$/)
  .openapi({ description: "The `next` value from the previous page." });

const snapshot = createRoute({
  method: "get",
  path: "/api/sync/snapshot",
  tags: ["Sync"],
  summary:
    "Every live folder and file under a folder (the files root by default), in pages. Replay changes after the first page's changeCursor once all pages are read.",
  middleware: [requireUser],
  request: {
    query: z.object({
      folderId: z.string().min(1).optional(),
      cursor: SnapshotCursor.optional(),
      limit: z.coerce.number().int().min(1).max(5000).default(1000),
    }),
  },
  responses: {
    200: json(
      z.object({
        items: z.array(SnapshotItemSchema),
        next: SnapshotCursor.nullable(),
        changeCursor: Cursor,
      }),
      "One page.",
    ),
    ...errorResponses,
  },
});

const events = createRoute({
  method: "get",
  path: "/api/sync/events",
  tags: ["Sync"],
  summary:
    'Server-sent events. Each message is `{"type":"changes","latestSeq":"<cursor>"}`, sent on connect and after each change. A comment line arrives every 25 seconds.',
  middleware: [requireUser],
  responses: {
    200: {
      description: "An event stream.",
      content: { "text/event-stream": { schema: z.string() } },
    },
    ...errorResponses,
  },
});

const keepMine = createRoute({
  method: "post",
  path: "/api/sync/conflicts/keep-mine",
  tags: ["Sync"],
  summary:
    "Keep this device's version after a conflict. The file keeps its id and takes the conflict copy's content; its old content goes to the trash under the file's name. Send an Idempotency-Key.",
  middleware: [requireUser, storageMutation()],
  request: {
    body: jsonBody(
      z.object({
        fileId: z.string().min(1),
        ifRevision: z.number().int().min(0),
        conflictCopyId: z.string().min(1),
      }),
    ),
  },
  responses: {
    200: json(FileMutationSchema, "Kept."),
    ...errorResponses,
  },
});

/** One consistent read: the rows and the cursor come from the same moment. */
const repeatableRead = <T>(
  callback: (tx: Prisma.TransactionClient) => Promise<T>,
) => getPrisma().$transaction(callback, { isolationLevel: "RepeatableRead" });

const toNumber = (value: bigint | null) =>
  value === null ? null : Number(value);

export const syncRoutes = router()
  .openapi(version, (c) =>
    c.json(
      { version: resolveAppVersion(), minClientVersion: MIN_CLIENT_VERSION },
      200,
    ),
  )
  .openapi(changes, async (c) => {
    const { after, limit } = c.req.valid("query");
    try {
      const page = await repeatableRead((tx) =>
        readStorageChanges(tx, {
          ownerUserId: c.var.session.user.id,
          after: BigInt(after),
          limit,
        }),
      );
      return c.json(
        {
          changes: page.changes.map((change) => ({
            ...change,
            seq: String(change.seq),
            kind: change.kind as z.infer<typeof ChangeSchema>["kind"],
            itemType: change.itemType as z.infer<typeof ItemType>,
            sizeBytes: toNumber(change.sizeBytes),
          })),
          cursor: String(page.cursor),
          hasMore: page.hasMore,
        },
        200,
      );
    } catch (error) {
      if (error instanceof StorageChangesExpiredError) {
        throw httpError(410, "CHANGES_EXPIRED", error.message);
      }
      throw error;
    }
  })
  .openapi(snapshot, async (c) => {
    const { folderId, cursor, limit } = c.req.valid("query");
    const after = cursor
      ? {
          type: cursor.startsWith("folder:")
            ? ("folder" as const)
            : ("file" as const),
          id: cursor.slice(cursor.indexOf(":") + 1),
        }
      : null;
    const result = await repeatableRead(async (tx) => {
      const changeCursor = await currentStorageChangeCursor(tx);
      const page = await readStorageSnapshotPage(tx, {
        ownerUserId: c.var.session.user.id,
        folderId: folderId ?? null,
        after,
        limit,
      });
      return page && { ...page, changeCursor };
    });
    if (!result) throw httpError(404, "FOLDER_NOT_FOUND", "Folder not found.");
    const last = result.items.at(-1);
    return c.json(
      {
        items: result.items.map((item) => ({
          ...item,
          sizeBytes: toNumber(item.sizeBytes),
        })),
        next: result.hasMore && last ? `${last.type}:${last.id}` : null,
        changeCursor: String(result.changeCursor),
      },
      200,
    );
  })
  .openapi(keepMine, async (c) =>
    c.json(
      await filesService.keepMine({
        ...actorOf(c.var.session),
        ...c.req.valid("json"),
        idempotencyKey: c.var.idempotencyKey,
      }),
      200,
    ),
  )
  .openapi(events, (c) => {
    const ownerUserId = c.var.session.user.id;
    return streamSSE(c, async (stream) => {
      const send = (latestSeq: string) =>
        stream.writeSSE({
          data: JSON.stringify({ type: "changes", latestSeq }),
        });
      const unsubscribe = await subscribeLiveEvents((channel, payload) => {
        if (channel !== "changes") return;
        const message = JSON.parse(payload) as {
          ownerUserId: string;
          latestSeq: string;
        };
        if (message.ownerUserId === ownerUserId) void send(message.latestSeq);
      });
      stream.onAbort(unsubscribe);
      await send(String(await currentStorageChangeCursor(getPrisma())));
      while (!stream.aborted) {
        await stream.sleep(HEARTBEAT_MS);
        if (!stream.aborted) await stream.write(": keep-alive\n\n");
      }
      unsubscribe();
    }) as never;
  });
