import { canHaveThumbnail } from "@staaash/db/viewer-contract";
import type { FileSummary } from "@/server/files/types";
import type { ViewerFile } from "@/components/file-list/media-viewer";

// Runs on the server and in the browser, so it only needs these fields.
type ViewableFile = Pick<
  FileSummary,
  "id" | "name" | "mimeType" | "viewerKind" | "storageMutation"
>;
type FolderItems = Array<
  { id: string } & ({ kind: "file"; data: ViewableFile } | { kind: "folder" })
>;

export const privateViewerFiles = (files: ViewableFile[]): ViewerFile[] =>
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

export async function nextLoadedViewer<Items extends FolderItems>(
  index: number,
  items: Items,
  total: number,
  excluded: Set<string>,
  load: () => Promise<Items>,
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
