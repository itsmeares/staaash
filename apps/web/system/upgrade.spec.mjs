import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { test, expect } from "@playwright/test";
import {
  anonymous,
  auditTotals,
  downloaded,
  hash,
  json,
  reconcile,
  signedIn,
  sql,
  stack,
  unique,
  upload,
} from "./support.mjs";

test("a populated stable installation upgrades without losing files, links, preferences or uploads", async () => {
  const owner = await signedIn();
  const state = await stack();
  const snapshotPath = path.join(state.root, "upgrade.json");
  try {
    if (process.env.STAAASH_TEST_PHASE === "seed") {
      await json(owner, "/api/user/preferences", {
        theme: "dark",
        timeZone: "Europe/Istanbul",
        showUpdateNotifications: false,
      });
      const { folder } = await json(
        owner,
        "/api/files/folders",
        { name: unique("Upgrade café") },
        201,
      );
      const { folder: nested } = await json(
        owner,
        "/api/files/folders",
        { name: "Nested", parentId: folder.id },
        201,
      );
      const bytes = Buffer.from("Stable original with accents: café, résumé.");
      const file = await upload(owner, "Résumé.txt", bytes, {
        folderId: nested.id,
      });
      const trashed = await upload(
        owner,
        "Trashed.txt",
        Buffer.from("trashed original"),
        { folderId: nested.id },
      );
      await json(owner, `/api/files/files/${file.id}/favorite`, {
        favorite: true,
      });
      await json(owner, `/api/files/files/${trashed.id}/trash`, {});
      const { share } = await json(
        owner,
        "/api/shares",
        {
          targetType: "file",
          fileId: file.id,
          expiresAt: new Date(Date.now() + 3600_000).toISOString(),
        },
        201,
      );
      const session = await json(
        owner,
        "/api/uploads/sessions",
        {
          originalName: "Resumed.txt",
          mimeType: "text/plain",
          totalSizeBytes: 16 * 1024 * 1024 + 17,
          folderId: nested.id,
        },
        201,
      );
      const resumeBytes = Buffer.alloc(16 * 1024 * 1024 + 17, 0x42);
      const chunk = session.chunkSizeBytes;
      expect(Number.isInteger(chunk)).toBe(true);
      expect(chunk).toBeGreaterThan(0);
      expect(chunk).toBeLessThan(resumeBytes.length);
      const response = await owner.patch(
        `/api/uploads/sessions/${session.id}`,
        {
          headers: {
            "Content-Range": `bytes 0-${chunk - 1}/${resumeBytes.length}`,
          },
          data: resumeBytes.subarray(0, chunk),
        },
      );
      expect(response.ok(), await response.text()).toBe(true);
      await writeFile(
        snapshotPath,
        JSON.stringify({
          file,
          trashed,
          folder,
          nested,
          share,
          session,
          chunk,
          checksum: hash(resumeBytes),
        }),
      );
      return;
    }
    expect(process.env.STAAASH_TEST_PHASE).toBe("verify");
    const old = JSON.parse(await readFile(snapshotPath, "utf8"));
    await downloaded(
      owner,
      old.file.id,
      Buffer.from("Stable original with accents: café, résumé."),
    );
    const visitor = await anonymous();
    try {
      const response = await visitor.get(
        `${new URL(old.share.shareUrl).pathname}/download`,
      );
      expect(response.status()).toBe(200);
      expect(hash(await response.body())).toBe(
        hash(Buffer.from("Stable original with accents: café, résumé.")),
      );
    } finally {
      await visitor.dispose();
    }
    const session = await (await owner.get("/api/auth/session")).json();
    expect(session.user.preferences).toMatchObject({
      theme: "dark",
      timeZone: "Europe/Istanbul",
      showUpdateNotifications: false,
    });
    expect(
      await sql('SELECT "fileId" FROM "FavoriteFile" WHERE "fileId" = $1', [
        old.file.id,
      ]),
    ).toHaveLength(1);
    expect(
      (await owner.get(`/api/uploads/sessions/${old.session.id}`)).status(),
    ).toBe(200);
    const bytes = Buffer.alloc(16 * 1024 * 1024 + 17, 0x42);
    for (let offset = old.chunk; offset < bytes.length; offset += old.chunk) {
      const end = Math.min(offset + old.chunk, bytes.length);
      const patch = await owner.patch(
        `/api/uploads/sessions/${old.session.id}`,
        {
          headers: {
            "Content-Range": `bytes ${offset}-${end - 1}/${bytes.length}`,
          },
          data: bytes.subarray(offset, end),
        },
      );
      expect(patch.ok(), await patch.text()).toBe(true);
    }
    const resumed = await json(
      owner,
      `/api/uploads/sessions/${old.session.id}/complete`,
      { expectedChecksum: old.checksum },
      201,
    );
    await downloaded(owner, resumed.id, bytes);
    await json(owner, `/api/files/files/${old.trashed.id}/restore`, {});
    await downloaded(owner, old.trashed.id, Buffer.from("trashed original"));
    await downloaded(
      owner,
      (await upload(owner, "After-upgrade.txt", Buffer.from("new bytes"))).id,
      Buffer.from("new bytes"),
    );
    await auditTotals();
    await reconcile(owner);
    expect(
      await sql(
        "SELECT id FROM \"StorageMutation\" WHERE status NOT IN ('succeeded','aborted')",
      ),
    ).toEqual([]);
    expect(
      await sql(
        'SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NULL AND rolled_back_at IS NULL',
      ),
    ).toEqual([]);
  } finally {
    await owner.dispose();
  }
});
