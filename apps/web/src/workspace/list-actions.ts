import { api, read } from "@/lib/api";
import type { ListQuery } from "@/server/list-window";

// More rows for the long lists, fetched as the person scrolls or selects all.

const views = api.api.views;

export const loadFavorites = (query: ListQuery) =>
  read(
    views.favorites[":selection{selection}?"].$post({
      param: { selection: undefined },
      json: { query },
    }),
  );

export const selectFavorites = (query: ListQuery) =>
  read(
    views.favorites[":selection{selection}?"].$post({
      param: { selection: "selection" },
      json: { query },
    }),
  );

export const loadRecent = (show: "activity" | "added", query: ListQuery) =>
  read(
    views.recent[":show{activity|added}"][":selection{selection}?"].$post({
      // Named even when empty, or the client leaves the pattern in the URL.
      param: { show, selection: undefined },
      json: { query },
    }),
  );

export const selectRecent = (show: "activity" | "added", query: ListQuery) =>
  read(
    views.recent[":show{activity|added}"][":selection{selection}?"].$post({
      param: { show, selection: "selection" },
      json: { query },
    }),
  );

export const resolveActivity = (query: ListQuery, ids: string[]) =>
  read(views.recent.activity.resolve.$post({ json: { query, ids } }));

export const loadTrash = (query: ListQuery) =>
  read(views.trash.$post({ json: { query } }));

export const selectTrash = (query: ListQuery) =>
  read(views.trash.selection.$post({ json: { query } }));

export const loadShares = (active: boolean, query: ListQuery) =>
  read(
    views.shares[":state{live|off}"].$post({
      param: { state: active ? "live" : "off" },
      json: { query },
    }),
  );

export const selectShares = (active: boolean, query: ListQuery) =>
  read(
    views.shares[":state{live|off}"].selection.$post({
      param: { state: active ? "live" : "off" },
      json: { query },
    }),
  );

export const loadFolderBatch = (folderId: string, query: ListQuery) =>
  read(
    views.files[":folderId"].batch.$post({
      param: { folderId },
      json: { query },
    }),
  );

export const loadFolderSelection = (folderId: string, query: ListQuery) =>
  read(
    views.files[":folderId"].selection.$post({
      param: { folderId },
      json: { query },
    }),
  );

export const loadViewerBatch = (folderId: string, offset: number) =>
  read(
    views.files[":folderId"].viewer.$get({
      param: { folderId },
      query: { offset: String(offset) },
    }),
  );
