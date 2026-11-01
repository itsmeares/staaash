import { randomUUID } from "node:crypto";
import { expect, it } from "vite-plus/test";
import { getPrisma, Prisma } from "@staaash/db/client";
import { resolveViewerKind } from "@staaash/config/media-types";
import { fileMimeTypeSql } from "./file-types";
import { getListWindow } from "./list-window";
import { getActivityPage } from "./retrieval/activity-page";
import { getStorageBreakdown } from "./user-storage";
import { createResumableSession } from "./uploads/session-service";
import { stageUpload } from "./uploads";
import { getSystemSettings } from "./settings";

it("agrees on legacy HEIC photos across SQL, lists, activity, and storage", async () => {
  const db = getPrisma();
  const user = await db.user.create({
    data: {
      email: `${randomUUID()}@types.test`,
      storageId: randomUUID(),
      passwordHash: "fake",
    },
  });
  const folder = await db.folder.create({
    data: {
      ownerUserId: user.id,
      name: "Files",
      isFilesRoot: true,
    },
  });
  const entries = [
    ["photo.HEIC", "application/octet-stream"],
    ["photo.HeIf", ""],
    ["photo.bin", " IMAGE/HEIC; charset=binary "],
    ["vendor.heic", "application/x-heic"],
    ["plain.jpg", "image/jpeg"],
    ["document.heic", "application/pdf"],
    ["notes.heic", "text/plain"],
    ["video.heic", "video/mp4"],
    ["notes.txt", "application/octet-stream"],
    ["heic", "application/octet-stream"],
  ] as const;
  const created = [];
  for (const [name, mimeType] of entries) {
    const result = await db.$queryRaw<Array<{ mime: string }>>`
      SELECT ${fileMimeTypeSql(Prisma.sql`${mimeType}`, Prisma.sql`${name}`)} AS mime
    `;
    expect(result[0]!.mime.startsWith("image/")).toBe(
      resolveViewerKind(mimeType, name) === "image",
    );
    created.push(
      await db.file.create({
        data: {
          ownerUserId: user.id,
          folderId: folder.id,
          originalName: name,
          mimeType,
          storageKey: `${user.storageId}/${name}`,
          sizeBytes: 10n,
        },
      }),
    );
  }
  const imageIds = created
    .filter(
      (file) => resolveViewerKind(file.mimeType, file.originalName) === "image",
    )
    .map((file) => file.id);
  const query = {
    userId: user.id,
    scope: "folder" as const,
    folderId: folder.id,
    query: { filter: "image" as const, limit: 2, sort: "name" as const },
  };
  const first = await getListWindow(query);
  const rest = await getListWindow({
    ...query,
    query: { ...query.query, offset: 2, limit: 100 },
  });
  expect(first.total).toBe(imageIds.length);
  expect(rest.total).toBe(imageIds.length);
  expect([...first.items, ...rest.items].map((file) => file.id).sort()).toEqual(
    imageIds.sort(),
  );
  await db.recentFile.createMany({
    data: imageIds.map((fileId) => ({
      userId: user.id,
      fileId,
      lastAction: "uploaded",
      lastInteractedAt: new Date("2026-11-01T12:00:00Z"),
    })),
  });
  const activity = await getActivityPage(user.id);
  expect(activity.items).toHaveLength(1);
  expect(activity.items[0]!.batchNoun).toBe("photos");
  expect(activity.items[0]!.batchSize).toBe(imageIds.length);
  const storage = await getStorageBreakdown(user.id);
  expect(storage.byKind.photos).toBe(imageIds.length * 10);
  expect(
    (await db.file.findUniqueOrThrow({ where: { id: created[0]!.id } }))
      .mimeType,
  ).toBe("application/octet-stream");

  await getSystemSettings();
  for (const [name, expected] of [
    ["new.HEIC", "image/heic"],
    ["new.heif", "image/heif"],
  ] as const) {
    const session = await createResumableSession({
      ownerUserId: user.id,
      folderId: folder.id,
      originalName: name,
      mimeType: "application/octet-stream",
      totalSizeBytes: 4,
      expectedChecksum: null,
      conflictStrategy: "fail",
    });
    expect(session.mimeType).toBe(expected);
    const staged = await stageUpload({
      file: new File(["fake"], name, { type: "application/octet-stream" }),
      clientKey: randomUUID(),
      originalName: name,
      conflictStrategy: "fail",
    });
    expect(staged.mimeType).toBe(expected);
  }
});
