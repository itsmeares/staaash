import { queryOptions } from "@tanstack/react-query";

import { api, read } from "@/lib/api";

const views = api.api.views;

export const entryQuery = queryOptions({
  queryKey: ["entry"],
  queryFn: () => read(views.entry.$get()),
});

export const shellQuery = queryOptions({
  queryKey: ["shell"],
  queryFn: () => read(views.shell.$get()),
});

export const homeQuery = queryOptions({
  queryKey: ["home"],
  queryFn: () => read(views.home.$get()),
});

export const filesQuery = (folderId?: string) =>
  queryOptions({
    queryKey: ["files", folderId ?? "root"],
    queryFn: () =>
      read(
        folderId
          ? views.files[":folderId"].$get({ param: { folderId } })
          : views.files.$get(),
      ),
  });

export const viewerQuery = (fileId: string) =>
  queryOptions({
    queryKey: ["viewer", fileId],
    queryFn: () => read(views.viewer[":fileId"].$get({ param: { fileId } })),
  });

export const storageUnavailableQuery = (folderId: string) =>
  queryOptions({
    queryKey: ["storage-unavailable", folderId],
    queryFn: () =>
      read(
        views["storage-unavailable"][":folderId"].$get({ param: { folderId } }),
      ),
    staleTime: 0,
  });

export const favoritesQuery = queryOptions({
  queryKey: ["favorites"],
  queryFn: () => read(views.favorites.$post({ json: { query: {} } })),
});

export const recentQuery = (show: "activity" | "added", grouped: boolean) =>
  queryOptions({
    queryKey: ["recent", show, grouped],
    queryFn: () =>
      read(
        views.recent[":show{activity|added}"].$post({
          param: { show },
          json: { query: { grouped } },
        }),
      ),
  });

export const trashQuery = queryOptions({
  queryKey: ["trash"],
  queryFn: () => read(views.trash.$post({ json: { query: {} } })),
});

export const sharesQuery = (state: "live" | "off") =>
  queryOptions({
    queryKey: ["shares", state],
    queryFn: () =>
      read(
        views.shares[":state{live|off}"].$post({
          param: { state },
          json: { query: {} },
        }),
      ),
  });

export const searchQuery = (q: string, page: number, pageSize: number) =>
  queryOptions({
    queryKey: ["search", q, page, pageSize],
    queryFn: () =>
      read(
        views.search.$get({
          query: { q, page: String(page), pageSize: String(pageSize) },
        }),
      ),
  });

export const settingsQuery = queryOptions({
  queryKey: ["settings"],
  queryFn: () => read(views.settings.$get()),
});

const admin = views.admin;

export const adminOverviewQuery = queryOptions({
  queryKey: ["admin", "overview"],
  queryFn: () => read(admin.overview.$get()),
});

export const adminStorageQuery = queryOptions({
  queryKey: ["admin", "storage"],
  queryFn: () => read(admin.storage.$get()),
});

export const adminUsersQuery = queryOptions({
  queryKey: ["admin", "users"],
  queryFn: () => read(admin.users.$get()),
});

export const adminUserQuery = (userId: string) =>
  queryOptions({
    queryKey: ["admin", "users", userId],
    queryFn: () => read(admin.users[":userId"].$get({ param: { userId } })),
  });

export const adminJobsQuery = queryOptions({
  queryKey: ["admin", "jobs"],
  queryFn: () => read(admin.jobs.$get()),
});

export const adminSettingsQuery = queryOptions({
  queryKey: ["admin", "settings"],
  queryFn: () => read(admin.settings.$get()),
});

export const shareQuery = (token: string, folderId?: string) =>
  queryOptions({
    queryKey: ["share", token, folderId ?? null],
    queryFn: () =>
      read(
        api.s[":token"].view.$get({
          param: { token },
          query: folderId ? { folderId } : {},
        }),
      ),
  });

export const sharedFileQuery = (token: string, fileId: string) =>
  queryOptions({
    queryKey: ["share", token, "file", fileId],
    queryFn: () =>
      read(
        api.s[":token"].view.files[":fileId"].$get({
          param: { token, fileId },
        }),
      ),
  });
