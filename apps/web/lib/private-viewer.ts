import { canHaveThumbnail } from "@staaash/db/viewer-contract";
import type { FileSummary } from "@/server/files/types";
import type { ViewerFile } from "@/components/file-list/media-viewer";
import type { folderBatchItems } from "@/app/(workspace)/files/folder-batch";

type FolderItems = ReturnType<typeof folderBatchItems>["items"];

export const privateViewerFiles = (files: FileSummary[]): ViewerFile[] =>
  files.flatMap((file) =>
    file.viewerKind && !file.storageMutation
      ? [
          {
            id: file.id,
            name: file.name,
            mimeType: file.mimeType,
            viewerKind: file.viewerKind,
            thumbnailUrl: canHaveThumbnail(file.mimeType, file.name)
              ? `/api/files/files/${file.id}/thumbnail`
              : null,
          },
        ]
      : [],
  );

const batchViewerFiles = (items: FolderItems, excluded: Set<string>) =>
  privateViewerFiles(
    items.flatMap((item) =>
      item.kind === "file" && !excluded.has(item.id) ? [item.data] : [],
    ),
  );

export async function nextLoadedViewer(
  index: number,
  items: FolderItems,
  total: number,
  excluded: Set<string>,
  load: () => Promise<FolderItems>,
) {
  let files = batchViewerFiles(items, excluded);
  while (!files[index] && items.length < total) {
    const next = await load();
    if (next.length <= items.length) break;
    items = next;
    files = batchViewerFiles(items, excluded);
  }
  return files[index];
}
