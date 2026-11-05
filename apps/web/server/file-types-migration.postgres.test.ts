import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Client } from "pg";
import { expect, inject, it } from "vite-plus/test";
import { getPrisma } from "@staaash/db/client";

const migrationPath = new URL(
  "../../../packages/db/prisma/migrations/20261106000000_file_types_from_names/migration.sql",
  import.meta.url,
);

it("gives generic uploads their type from the name and keeps folder dates", async () => {
  const db = getPrisma();
  const user = await db.user.create({
    data: {
      email: `${randomUUID()}@types.test`,
      storageId: randomUUID(),
      passwordHash: "fake",
    },
  });
  const folder = await db.folder.create({
    data: { ownerUserId: user.id, name: "Files", isFilesRoot: true },
  });
  const entries = [
    ["Photo.PNG", "application/octet-stream", "image/png"],
    ["clip.mp4", " Application/Octet-Stream; charset=binary", "video/mp4"],
    ["song.mp3", "", "audio/mpeg"],
    ["declared.mp4", "video/webm", "video/webm"],
    ["page.html", "application/octet-stream", "application/octet-stream"],
    ["archive.png.zip", "application/octet-stream", "application/octet-stream"],
    ["png", "application/octet-stream", "application/octet-stream"],
  ] as const;
  const files = [];
  for (const [name, mimeType] of entries) {
    files.push(
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
  const folderDate = new Date("2026-01-01T00:00:00Z");
  await db.folder.updateMany({
    where: { id: folder.id },
    data: { updatedAt: folderDate },
  });

  const client = new Client({
    connectionString: inject("postgresDatabaseUrl"),
  });
  await client.connect();
  try {
    await client.query(await readFile(migrationPath, "utf8"));
  } finally {
    await client.end();
  }

  const stored = await db.file.findMany({
    where: { id: { in: files.map((file) => file.id) } },
    select: { originalName: true, mimeType: true },
  });
  expect(
    Object.fromEntries(
      stored.map((file) => [file.originalName, file.mimeType]),
    ),
  ).toEqual(
    Object.fromEntries(entries.map(([name, , after]) => [name, after])),
  );
  expect(
    (await db.folder.findUniqueOrThrow({ where: { id: folder.id } })).updatedAt,
  ).toEqual(folderDate);
});
