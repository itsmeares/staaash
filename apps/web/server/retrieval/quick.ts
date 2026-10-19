import { getSearchPage } from "./search-page";
import { getRetrievalPage } from "./page";

export async function getQuickResults(userId: string, query: string) {
  if (!query)
    return getRetrievalPage(userId, "recent", {
      limit: 8,
      liveOnly: true,
      usableOnly: true,
    });
  const [folders, files] = await Promise.all([
    getSearchPage(userId, query, {
      kind: "folder",
      limit: 3,
      usableOnly: true,
    }),
    getSearchPage(userId, query, { kind: "file", limit: 8, usableOnly: true }),
  ]);
  return {
    items: [
      ...folders.items,
      ...files.items.slice(0, 8 - folders.items.length),
    ],
    total: folders.total + files.total,
  };
}
