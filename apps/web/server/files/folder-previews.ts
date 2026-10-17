import { getPrisma, Prisma } from "@staaash/db/client";

/**
 * The two newest files with a ready thumbnail directly inside each folder,
 * for the photos that peek out of folder cards. One query for the page.
 */
export async function listFolderPreviewFileIds(
  folderIds: string[],
): Promise<Record<string, string[]>> {
  if (folderIds.length === 0) return {};
  const rows = await getPrisma().$queryRaw<
    Array<{ folderId: string; fileId: string }>
  >(Prisma.sql`
    SELECT "folderId", "fileId" FROM (
      SELECT f."folderId", d."fileId",
        ROW_NUMBER() OVER (PARTITION BY f."folderId" ORDER BY f."createdAt" DESC) AS rank
      FROM "MediaDerivative" d
      JOIN "File" f ON f.id = d."fileId"
      WHERE d.kind = 'thumbnail'
        AND d.status = 'ready'
        AND f."deletedAt" IS NULL
        AND f."folderId" IN (${Prisma.join(folderIds)})
    ) ranked
    WHERE rank <= 2`);
  const byFolder: Record<string, string[]> = {};
  for (const row of rows) (byFolder[row.folderId] ??= []).push(row.fileId);
  return byFolder;
}
