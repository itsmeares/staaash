import { getPrisma } from "@staaash/db/client";

export const getFolderSizeBytes = async (folderId: string) => {
  const folder = await getPrisma().folder.findUnique({
    where: { id: folderId },
    select: { treeSizeBytes: true, deletedAt: true },
  });
  return !folder || folder.deletedAt ? 0 : Number(folder.treeSizeBytes);
};
