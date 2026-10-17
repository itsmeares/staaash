import { getPrisma } from "@staaash/db/client";

/** Bytes of every live file anywhere under a folder, for share pages and Details. */
export const getFolderSizeBytes = async (folderId: string) => {
  // UNION, not UNION ALL: a broken parent loop ends instead of running forever.
  const [row] = await getPrisma().$queryRaw<Array<{ bytes: bigint }>>`
    WITH RECURSIVE tree AS (
      SELECT id FROM "Folder" WHERE id = ${folderId} AND "deletedAt" IS NULL
      UNION
      SELECT child.id FROM "Folder" child
      JOIN tree ON child."parentId" = tree.id
      WHERE child."deletedAt" IS NULL
    )
    SELECT COALESCE(SUM(file."sizeBytes"), 0)::bigint AS bytes
    FROM "File" file JOIN tree ON file."folderId" = tree.id
    WHERE file."deletedAt" IS NULL`;
  return Number(row?.bytes ?? 0);
};
