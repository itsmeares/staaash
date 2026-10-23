import type { Context } from "hono";
import { validator } from "hono/validator";
import { getCookie } from "hono/cookie";
import { z } from "zod";

import { ALL_SUPPORTED_JOB_KINDS } from "@staaash/db/jobs";
import { getStorageMutationHealth } from "@staaash/db/storage-mutations";

import { plain } from "@/lib/plain";
import { accountNote, getInitials, roleLabel } from "@/lib/user";
import type { FirstRunKind } from "@/components/public/first-run";
import { toDevice } from "@/lib/user-agent";
import {
  getAdminJobList,
  getAdminJobSummary,
  getLastRunPerKind,
  toJsonAdminJob,
  toJsonAdminJobSummary,
} from "@/server/admin/jobs";
import {
  getAdminMediaDerivativeSummary,
  toJsonAdminMediaDerivativeSummary,
} from "@/server/admin/media-derivatives";
import { getAdminOverviewSummary } from "@/server/admin/overview";
import { getAdminStorageSummary } from "@/server/admin/storage";
import { getUpdateState } from "@/server/admin/updates";
import { resolveAppVersion } from "@/server/app-version";
import { canAccessAdminSurface } from "@/server/access";
import { authService } from "@/server/auth/service";
import type { AuthUser } from "@/server/auth/types";
import { prismaFilesRepository } from "@/server/files/repository";
import { filesService } from "@/server/files/service";
import { loadFilesViewProps } from "@/server/files/view-props";
import { getAccessiblePrivateFile } from "@/server/files/viewer";
import { getViewerWindow } from "@/server/files/viewer-window";
import { FilesError } from "@/server/files/errors";
import {
  actorOf,
  requireAdmin,
  requireOwner,
  requireUser,
  router,
  sessionToken,
  type AppEnv,
  type Session,
} from "@/server/http/core";
import { getListWindow, listQuerySchema } from "@/server/list-window";
import { getShareBaseUrl, getBaseUrl } from "@/server/request";
import {
  getActivityPage,
  resolveActivitySelection,
} from "@/server/retrieval/activity-page";
import {
  getPinnedFavorites,
  getRetrievalPage,
  getRetrievalSelection,
} from "@/server/retrieval/page";
import {
  recordFolderAccessBestEffort,
  recordFileAccessBestEffort,
} from "@/server/retrieval/recent-tracking";
import { getSearchPage } from "@/server/retrieval/search-page";
import { getSystemSettings } from "@/server/settings";
import { SHARE_ACCESS_COOKIE_NAME } from "@/server/sharing/access-cookie";
import { isShareError, ShareError } from "@/server/sharing/errors";
import { getSharesPage } from "@/server/sharing/page";
import { getPublicShareFilePreview } from "@/server/sharing/public-file-preview";
import { isPublicShareFileNativeViewSafe } from "@/server/media/public-share-content-policy";
import { getFolderSizeBytes } from "@/server/files/folder-size";
import {
  toPublicFile,
  toPublicShare,
  toPublicShareView,
} from "@/server/sharing/public-view";
import { sharingService } from "@/server/sharing/service";
import { StorageEntityUnavailableError } from "@/server/storage-read-guard";
import {
  getInstanceDiskInfo,
  getStorageBreakdown,
  getUserStorageUsed,
} from "@/server/user-storage";
import {
  pinnedFavorites,
  toFavoriteClientItem,
} from "@/src/workspace/favorites/favorites-helpers";
import { folderBatchItems } from "@/src/workspace/files/folder-batch";
import {
  toActivityClientItem,
  toRecentClientItem,
} from "@/src/workspace/recent/recent-helpers";
import { toTrashClientItems } from "@/src/workspace/trash/trash-helpers";

// The data each page shows, shaped for the bundled web UI. Not part of the
// public API contract.

const ListBody = z.object({ query: listQuerySchema.partial().default({}) });
const listJson = validator("json", (value) => ListBody.parse(value));

/** The signed-in person as the top bar and menus show them. */
const personOf = (user: AuthUser) => {
  const prefs: Partial<NonNullable<AuthUser["preferences"]>> =
    user.preferences ?? {};
  return {
    label: user.displayName ?? user.email,
    email: user.email,
    initials: getInitials(user.displayName, user.email),
    avatarUrl: user.avatarUrl,
    defaultView: prefs.defaultView,
    notify: prefs.showUpdateNotifications ?? true,
    timeZone: prefs.timeZone ?? null,
    clock: prefs.clockFormat === "12h" ? "12h" : "24h",
  };
};

const loadPins = async (user: AuthUser) => {
  if (!user.preferences?.showPinsInSidebar) return [];
  const favorites = await getPinnedFavorites(user.id);
  return pinnedFavorites(favorites).map((item) => ({
    id: item.id,
    kind: item.kind,
    name: item.name,
    href: item.href,
    ...(item.kind === "file"
      ? { mimeType: item.mimeType }
      : { color: item.color ?? null }),
  }));
};

const instanceName = async () =>
  (await authService.getSetupState()).instanceName?.trim() || "Staaash";

/** Which first-run steps a signed-in person still needs, if any. */
const firstRunKind = (user: AuthUser): FirstRunKind | null => {
  const onboarded = Boolean(user.preferences?.onboardingCompletedAt);
  if (onboarded) return user.passwordChangeRequiredAt ? "password" : null;
  if (user.isOwner) return "owner";
  return user.passwordChangeRequiredAt ? "member-password" : "member";
};

const filesProps = async (
  c: Context<AppEnv>,
  session: Session,
  folderId?: string,
  query?: z.infer<typeof ListBody>["query"],
) => {
  const actor = actorOf(session);
  const listing = await filesService.getFilesListing({
    ...actor,
    folderId,
    query,
  });
  return loadFilesViewProps({
    ...actor,
    listing,
    baseUrl: getShareBaseUrl(c.req.raw.headers),
    showFolderPreviews: session.user.preferences?.showFolderPreviews ?? true,
  });
};

const shareCookie = (c: Context) =>
  getCookie(c, SHARE_ACCESS_COOKIE_NAME) ?? null;

/** A share page that cannot show its item says why, without the details. */
const shareFailure = (error: unknown) => {
  if (error instanceof StorageEntityUnavailableError) throw error;
  const shareError = isShareError(error)
    ? error
    : new ShareError("SHARE_INVALID");
  return {
    kind: "error" as const,
    error: { code: shareError.code, message: shareError.message },
  };
};

const user = router().basePath("/api/views");
user.use("*", requireUser);

const userViews = user
  .get("/shell", async (c) => {
    const { user } = c.var.session;
    const isOwner = user.isAdmin;
    const [usage, diskInfo, updateState, name, pins] = await Promise.all([
      getUserStorageUsed(user.id),
      getInstanceDiskInfo(),
      // Update news is for owners; members only see the version.
      isOwner ? getUpdateState().catch(() => null) : null,
      instanceName(),
      loadPins(user),
    ]);
    return c.json(
      plain({
        info: {
          instanceName: name,
          pins,
          isOwner,
          canAdmin: canAccessAdminSurface(user.role),
          appVersion: resolveAppVersion(),
          usedBytes: usage.usedBytes,
          limitBytes: user.storageLimitBytes,
          diskUsedBytes: diskInfo?.usedBytes ?? null,
          diskCapacityBytes: diskInfo?.capacityBytes ?? null,
        },
        updateState,
        nodeVersion: process.version,
        person: personOf(user),
      }),
    );
  })
  .get("/home", async (c) => {
    const { session } = c.var;
    const [favorites, recent, pickUp, shares] = await Promise.all([
      getPinnedFavorites(session.user.id),
      getRetrievalPage(session.user.id, "recent", { limit: 8, liveOnly: true }),
      getRetrievalPage(session.user.id, "recent", {
        limit: 6,
        liveOnly: true,
        filesOnly: true,
      }),
      getSharesPage(
        actorOf(session),
        getShareBaseUrl(c.req.raw.headers),
        true,
        {
          limit: 5,
        },
      ),
    ]);
    return c.json(
      plain({
        hasFavorites: favorites.length > 0,
        pinned: pinnedFavorites(favorites).map(toRecentClientItem),
        recent: recent.items
          .filter((item) => !item.deletedAt)
          .map(toActivityClientItem)
          .slice(0, 8),
        pickUp: pickUp.items.map(toActivityClientItem),
        shares: shares.items.slice(0, 5).map((share) => ({
          id: share.id,
          name: share.target.name,
          kind: share.target.targetType,
          mimeType:
            share.target.targetType === "file"
              ? share.target.mimeType
              : undefined,
          downloadDisabled: share.downloadDisabled,
          hasPassword: share.hasPassword,
          expiresAt: share.expiresAt,
        })),
      }),
    );
  })
  .get("/files", async (c) => c.json(plain(await filesProps(c, c.var.session))))
  .get("/files/:folderId", async (c) => {
    const { session } = c.var;
    const props = await filesProps(c, session, c.req.param("folderId"));
    await recordFolderAccessBestEffort({
      ...actorOf(session),
      folderId: props.listing.currentFolder.id,
      action: "opened",
    });
    return c.json(plain(props));
  })
  .post("/files/:folderId/batch", listJson, async (c) => {
    const props = await filesProps(
      c,
      c.var.session,
      c.req.param("folderId"),
      c.req.valid("json").query,
    );
    return c.json(plain(folderBatchItems(props)));
  })
  .post("/files/:folderId/selection", listJson, async (c) => {
    const { session } = c.var;
    const folderId = c.req.param("folderId");
    const query = c.req.valid("json").query;
    const actor = actorOf(session);
    const refs = await getListWindow({
      userId: session.user.id,
      scope: "folder",
      folderId,
      query: { sort: "name", direction: "asc", ...query, offset: 0 },
      all: true,
    });
    const items: ReturnType<
      typeof folderBatchItems<Awaited<ReturnType<typeof loadFilesViewProps>>>
    >["items"] = [];
    for (let offset = 0; offset < refs.items.length; offset += 1000) {
      const listing = await filesService.getFilesListing({
        ...actor,
        folderId,
        selected: {
          total: refs.total,
          items: refs.items.slice(offset, offset + 1000),
        },
      });
      const props = await loadFilesViewProps({
        ...actor,
        listing,
        baseUrl: getShareBaseUrl(c.req.raw.headers),
        showFolderPreviews:
          session.user.preferences?.showFolderPreviews ?? true,
      });
      items.push(...folderBatchItems(props).items);
    }
    return c.json(plain({ items, total: items.length }));
  })
  .get(
    "/files/:folderId/viewer",
    validator("query", (value) =>
      z
        .object({ offset: z.coerce.number().int().min(0).catch(0) })
        .parse(value),
    ),
    async (c) =>
      c.json(
        plain(
          await getViewerWindow(
            c.var.session.user.id,
            c.req.param("folderId"),
            c.req.valid("query"),
          ),
        ),
      ),
  )
  .get("/viewer/:fileId", async (c) => {
    const { session } = c.var;
    const actor = actorOf(session);
    const file = await getAccessiblePrivateFile({
      ...actor,
      fileId: c.req.param("fileId"),
    });
    if (!file.viewerKind) throw new FilesError("FILE_NOT_FOUND");
    await recordFileAccessBestEffort({
      ...actor,
      fileId: file.id,
      action: "opened",
    });
    const folderId =
      file.folderId ??
      (await prismaFilesRepository.findFilesRoot!(session.user.id))!.id;
    const window = await getViewerWindow(
      session.user.id,
      folderId,
      {},
      file.id,
    );
    if (!window.files.some((entry) => entry.id === file.id)) {
      throw new FilesError("FILE_NOT_FOUND");
    }
    return c.json(
      plain({
        backHref: file.folderId ? `/files/f/${file.folderId}` : "/files",
        fileId: file.id,
        files: window.files,
        start: window.start,
        total: window.total,
        folderId,
      }),
    );
  })
  .get("/storage-unavailable/:folderId", async (c) => {
    try {
      const listing = await filesService.getFilesListing({
        ...actorOf(c.var.session),
        folderId: c.req.param("folderId"),
      });
      return c.json({
        available: true as const,
        isFilesRoot: listing.currentFolder.isFilesRoot,
      });
    } catch (error) {
      if (!(error instanceof StorageEntityUnavailableError)) throw error;
      return c.json({
        available: false as const,
        recoveryRequired: error.code === "STORAGE_RECOVERY_REQUIRED",
      });
    }
  })
  .post("/favorites/:selection{selection}?", listJson, async (c) => {
    const page = await (
      c.req.param("selection") ? getRetrievalSelection : getRetrievalPage
    )(c.var.session.user.id, "favorites", c.req.valid("json").query);
    return c.json(
      plain({ ...page, items: page.items.map(toFavoriteClientItem) }),
    );
  })
  .post(
    "/recent/:show{activity|added}/:selection{selection}?",
    listJson,
    async (c) => {
      const { session } = c.var;
      const show = c.req.param("show");
      const selection = Boolean(c.req.param("selection"));
      const query = c.req.valid("json").query;
      if (show === "activity" && query.grouped) {
        return c.json(
          plain(await getActivityPage(session.user.id, query, selection)),
        );
      }
      const page = await (selection ? getRetrievalSelection : getRetrievalPage)(
        session.user.id,
        show === "activity" ? "recent" : "added",
        query,
      );
      return c.json(
        plain({
          ...page,
          items: page.items.map(
            show === "activity" ? toActivityClientItem : toRecentClientItem,
          ),
        }),
      );
    },
  )
  .post(
    "/recent/activity/resolve",
    validator("json", (value) =>
      ListBody.extend({ ids: z.array(z.string()) }).parse(value),
    ),
    async (c) => {
      const { query, ids } = c.req.valid("json");
      return c.json(
        plain(
          await resolveActivitySelection(c.var.session.user.id, query, ids),
        ),
      );
    },
  )
  .post("/trash", listJson, async (c) => {
    const listing = await filesService.listTrashFolders({
      ...actorOf(c.var.session),
      query: c.req.valid("json").query,
    });
    return c.json(
      plain({
        items: toTrashClientItems(listing),
        total: listing.total,
        // The worker reads the same setting; 30 days unless an operator changed it.
        retentionDays: Number(process.env.TRASH_RETENTION_DAYS) || 30,
      }),
    );
  })
  .post("/trash/selection", listJson, async (c) => {
    const { session } = c.var;
    const actor = actorOf(session);
    const query = c.req.valid("json").query;
    const refs = await getListWindow({
      userId: session.user.id,
      scope: "trash",
      query: { ...query, offset: 0 },
      all: true,
    });
    const items: ReturnType<typeof toTrashClientItems> = [];
    for (let offset = 0; offset < refs.items.length; offset += 1000) {
      const listing = await filesService.listTrashFolders({
        ...actor,
        selected: {
          total: refs.total,
          items: refs.items.slice(offset, offset + 1000),
        },
      });
      items.push(...toTrashClientItems(listing));
    }
    return c.json(plain({ items, total: items.length }));
  })
  .post("/shares/:state{live|off}", listJson, async (c) =>
    c.json(
      plain(
        await getSharesPage(
          actorOf(c.var.session),
          getShareBaseUrl(c.req.raw.headers),
          c.req.param("state") === "live",
          c.req.valid("json").query,
        ),
      ),
    ),
  )
  .post("/shares/:state{live|off}/selection", listJson, async (c) => {
    const query = c.req.valid("json").query;
    return c.json(
      plain(
        await getSharesPage(
          actorOf(c.var.session),
          getShareBaseUrl(c.req.raw.headers),
          c.req.param("state") === "live",
          { ...query, offset: 0 },
          true,
        ),
      ),
    );
  })
  .get(
    "/search",
    validator("query", (value) =>
      z
        .object({
          q: z.string().default(""),
          page: z.coerce.number().int().min(1).catch(1),
          pageSize: z.coerce.number().int().min(1).max(200).catch(50),
        })
        .parse(value),
    ),
    async (c) => {
      const { q, page, pageSize } = c.req.valid("query");
      const query = q.trim();
      const result = await getSearchPage(c.var.session.user.id, query, {
        offset: (page - 1) * pageSize,
        limit: pageSize,
      });
      return c.json(
        plain({
          total: result.total,
          items: result.items.map(toRecentClientItem),
        }),
      );
    },
  )
  .get("/settings", async (c) => {
    const { session } = c.var;
    const prefs = session.user.preferences;
    const [storage, sessions] = await Promise.all([
      getStorageBreakdown(session.user.id),
      authService.listOwnSessions(session.user.id),
    ]);
    return c.json(
      plain({
        isOwner: session.user.isAdmin,
        prefs: {
          theme: prefs.theme as "light" | "dark" | "system",
          timeZone: prefs.timeZone,
          showUpdateNotifications: prefs.showUpdateNotifications,
          showFolderPreviews: prefs.showFolderPreviews,
          showPinsInSidebar: prefs.showPinsInSidebar,
          startPage: prefs.startPage as "home" | "files",
          defaultView: prefs.defaultView as "list" | "grid",
          clockFormat: prefs.clockFormat as "12h" | "24h",
        },
        sessions: sessions
          .map((entry) => toDevice(entry, session))
          .sort((a, b) => Number(b.current) - Number(a.current)),
        storage,
        profile: {
          name: session.user.displayName,
          email: session.user.email,
          avatarUrl: session.user.avatarUrl,
          role: roleLabel(session.user.role),
        },
      }),
    );
  });

const admin = router().basePath("/api/views/admin");
admin.use("*", requireUser, requireAdmin);

const adminViews = admin
  .get("/overview", async (c) => {
    const [summary, disk] = await Promise.all([
      getAdminOverviewSummary(c.var.session.user.id),
      getInstanceDiskInfo(),
    ]);
    return c.json(plain({ summary, disk }));
  })
  .get("/storage", async (c) => {
    const [summary, mutations, disk] = await Promise.all([
      getAdminStorageSummary(),
      getStorageMutationHealth(),
      getInstanceDiskInfo(),
    ]);
    return c.json(plain({ summary, mutations: mutations.active, disk }));
  })
  .get("/users", async (c) => {
    const { session } = c.var;
    const users = await authService.listUsers(session.user.id);
    const usage = await Promise.all(
      users.map(async (user) => (await getUserStorageUsed(user.id)).usedBytes),
    );
    return c.json(
      plain({
        canInvite: session.user.isOwner,
        signInUrl: new URL("/", getBaseUrl(c.req.raw.headers)).toString(),
        users: users.map((user, index) => ({
          id: user.id,
          email: user.email,
          displayName: user.displayName,
          avatarUrl: user.avatarUrl,
          role: user.role,
          storageLimitBytes: user.storageLimitBytes,
          storageUsedBytes: usage[index] ?? 0n,
          note: accountNote(user),
        })),
      }),
    );
  })
  .get("/users/:userId", async (c) => {
    const { session } = c.var;
    const userId = c.req.param("userId");
    const [user, sessions, usage, storageSummary] = await Promise.all([
      authService.getUser(session.user.id, userId),
      authService.listUserSessions(session.user.id, userId),
      getUserStorageUsed(userId),
      getAdminStorageSummary(),
    ]);
    const row = storageSummary.rows.find((entry) => entry.userId === user.id);
    return c.json(
      plain({
        canEdit: session.user.isOwner,
        user: {
          id: user.id,
          email: user.email,
          displayName: user.displayName,
          avatarUrl: user.avatarUrl,
          isOwner: user.isOwner,
          isAdmin: user.isAdmin,
          storageId: user.storageId,
          storageLimitBytes: user.storageLimitBytes,
          createdAt: user.createdAt,
          note: accountNote(user),
        },
        storage: {
          used: usage.usedBytes,
          files: row?.retainedFileCount ?? 0,
          folders: row?.retainedFolderCount ?? 0,
          lastChange: row?.lastContentActivityAt ?? null,
        },
        devices: sessions.map((entry) => toDevice(entry, session)),
        signInUrl: new URL("/", getBaseUrl(c.req.raw.headers)).toString(),
      }),
    );
  })
  .get("/jobs", async (c) => {
    const [lastRunPerKind, queueSummary, mediaDerivatives, problems] =
      await Promise.all([
        getLastRunPerKind(),
        getAdminJobSummary(),
        getAdminMediaDerivativeSummary(),
        getAdminJobList({ status: ["failed", "dead"], limit: 20 }),
      ]);
    return c.json(
      plain({
        initialLastRuns: Object.fromEntries(
          Object.entries(lastRunPerKind).map(([kind, job]) => [
            kind,
            job ? toJsonAdminJob(job) : null,
          ]),
        ),
        initialProblems: problems.items.map(toJsonAdminJob),
        initialDerivatives: toJsonAdminMediaDerivativeSummary(mediaDerivatives),
        initialSummary: toJsonAdminJobSummary(queueSummary),
        jobKinds: [...ALL_SUPPORTED_JOB_KINDS],
      }),
    );
  })
  .get("/settings", requireOwner, async (c) => {
    const [settings, updateState] = await Promise.all([
      getSystemSettings(),
      getUpdateState(),
    ]);
    return c.json(plain({ settings, updateState }));
  });

const entryView = router().get("/api/views/entry", async (c) => {
  // Any session, onboarded or not: this page finishes onboarding.
  const [setup, session, settings] = await Promise.all([
    authService.getSetupState(),
    authService.getSession(sessionToken(c)),
    getSystemSettings(),
  ]);
  const name = setup.instanceName?.trim() || "Staaash";
  if (session) {
    const kind = firstRunKind(session.user);
    return c.json({
      state: "signed-in" as const,
      instanceName: name,
      firstRun: kind,
      startPage: session.user.preferences?.startPage ?? "files",
      displayName: session.user.displayName,
      previews: {
        enabled: settings.mediaPreviewEnabled,
        onUpload: settings.mediaPreviewGenerateOnUpload,
        onFirstView: settings.mediaPreviewGenerateOnFirstView,
        onShare: settings.mediaPreviewGenerateOnShare,
      },
    });
  }
  return c.json({
    state: setup.isBootstrapped ? ("sign-in" as const) : ("setup" as const),
    instanceName: name,
  });
});

// Share views sit under /s/<token>/ so the link's unlock cookie comes along.
const shareViews = router()
  .get(
    "/s/:token/view",
    validator("query", (value) =>
      z.object({ folderId: z.string().optional() }).parse(value),
    ),
    async (c) => {
      const token = c.req.param("token");
      const { folderId } = c.req.valid("query");
      try {
        const resolution = await sharingService.resolvePublicShare({
          token,
          requestedFolderId: folderId,
          shareAccessCookieValue: shareCookie(c),
        });
        const filePreview =
          resolution.kind === "file" && resolution.access.isUnlocked
            ? await getPublicShareFilePreview(resolution.file)
            : null;
        return c.json(
          plain({
            kind: "share" as const,
            resolution: toPublicShareView(resolution),
            nativeInline:
              resolution.kind === "file" &&
              isPublicShareFileNativeViewSafe(resolution.file, filePreview),
            folderSizeBytes:
              resolution.kind === "folder" && resolution.access.isUnlocked
                ? await getFolderSizeBytes(resolution.listing.currentFolder.id)
                : 0,
          }),
        );
      } catch (error) {
        return c.json(shareFailure(error));
      }
    },
  )
  .get("/s/:token/view/files/:fileId", async (c) => {
    const { token, fileId } = c.req.param();
    const shareAccessCookieValue = shareCookie(c);
    try {
      const resolution = await sharingService.resolvePublicShareContext({
        token,
        shareAccessCookieValue,
      });
      if (resolution.kind !== "folder") {
        return c.json(shareFailure(new ShareError("SHARE_ACCESS_DENIED")));
      }
      if (resolution.access.requiresPassword && !resolution.access.isUnlocked) {
        return c.json({ kind: "locked" as const });
      }
      const { file } = await sharingService.getSharedNestedFileContent({
        token,
        fileId,
        shareAccessCookieValue,
      });
      if (!file.viewerKind) return c.json({ kind: "not-found" as const });
      const preview = await getPublicShareFilePreview(file);
      const root = `/s/${encodeURIComponent(token)}`;
      return c.json(
        plain({
          kind: "file" as const,
          backHref:
            file.folderId === resolution.listing.rootFolder.id
              ? root
              : `${root}/f/${file.folderId}`,
          contentHref: `${root}/files/${file.id}/content`,
          downloadHref: `${root}/files/${file.id}/download`,
          file: toPublicFile(file),
          nativeInline: isPublicShareFileNativeViewSafe(file, preview),
          share: toPublicShare(resolution.share),
        }),
      );
    } catch (error) {
      return c.json(shareFailure(error));
    }
  });

export const viewRoutes = router()
  .route("/", entryView)
  .route("/", userViews)
  .route("/", adminViews)
  .route("/", shareViews);
