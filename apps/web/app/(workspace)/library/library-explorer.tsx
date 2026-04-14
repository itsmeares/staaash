import type { LibraryListing } from "@/server/library/types";
import type { ShareLibraryLookup } from "@/server/sharing";

import { LibraryView } from "./library-view";

type LibraryExplorerProps = {
  listing: LibraryListing;
  currentPath: string;
  searchParams: Record<string, string | string[] | undefined>;
  shareLookup: ShareLibraryLookup;
  favoriteFileIds: string[];
  favoriteFolderIds: string[];
};

export function LibraryExplorer(props: LibraryExplorerProps) {
  return <LibraryView {...props} />;
}
