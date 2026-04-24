import type { FilesListing } from "@/server/files/types";
import type { ShareFilesLookup } from "@/server/sharing";

import { FilesView } from "./files-view";

type FilesExplorerProps = {
  listing: FilesListing;
  currentPath: string;
  searchParams: Record<string, string | string[] | undefined>;
  shareLookup: ShareFilesLookup;
  favoriteFileIds: string[];
  favoriteFolderIds: string[];
};

export function FilesExplorer(props: FilesExplorerProps) {
  return <FilesView {...props} />;
}
