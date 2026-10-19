import { privateViewerFiles } from "@/lib/private-viewer";
import { getListWindow, type ListQuery } from "@/server/list-window";
import { prismaFilesRepository } from "./repository";

export async function getViewerWindow(
  userId: string,
  folderId: string,
  query: ListQuery = {},
  aroundId?: string,
) {
  const page = await getListWindow({
    userId,
    scope: "folder",
    folderId,
    aroundId,
    query: {
      sort: "name",
      direction: "asc",
      ...query,
      filesOnly: true,
      viewerOnly: true,
      usableOnly: true,
      limit: 30,
    },
  });
  const files = await prismaFilesRepository.listFilesByIds(
    userId,
    page.items.map((item) => item.id),
  );
  const map = new Map(files.map((file) => [file.id, file]));
  return {
    total: page.total,
    start: page.start ?? query.offset ?? 0,
    files: privateViewerFiles(
      page.items.flatMap(({ id }) => {
        const file = map.get(id);
        return file ? [file] : [];
      }),
    ),
  };
}
