import type { Page } from "@playwright/test";
import type {
  Activity,
  AppState,
  DesktopApi,
} from "../../desktop/src/shared/types";

/** The desktop app's window, served by the brand config's second server. */
export const desktopURL = `http://127.0.0.1:${process.env.STAAASH_DESKTOP_UI_PORT}/`;

const MB = 1024 ** 2;

/**
 * Stands in for the desktop app's main process, so the real window shows the
 * demo household mid-sync. Only the desktop server's frames get it.
 */
export async function showDesktop(page: Page) {
  await page.addInitScript(
    ({ port, MB }) => {
      if (location.port !== port) return;
      const minutes = (count: number) => Date.now() - count * 60_000;
      const activity = (
        pairId: string,
        rel: string,
        direction: Activity["direction"],
        bytes: number,
        doneBytes: number,
        at: number,
      ): Activity => ({
        pairId,
        rel,
        direction,
        state: doneBytes < bytes ? "active" : "done",
        bytes,
        doneBytes,
        at,
      });
      const pair = (id: string, remoteLabel: string, folder: string) => ({
        id,
        localPath: `C:\\Users\\Jesse\\Staaash\\${folder}`,
        remoteFolderId: id,
        remoteLabel,
        mode: "two-way" as const,
      });
      const state: AppState = {
        appVersion: "2.0.0",
        platform: "win32",
        signedIn: true,
        avatarUrl: null,
        versionProblem: null,
        update: null,
        settings: {
          serverUrl: "https://drive.devries.home",
          email: "jesse@devries.home",
          deviceName: "Jesse's laptop",
          pairs: [
            pair("renovation", "Home renovation", "Home renovation"),
            pair("photos", "Photos", "Photos"),
            pair("documents", "Documents", "Documents"),
            pair("music", "Music", "Music"),
          ],
          ignore: [],
          minFreeBytes: 1024 * MB,
          uploadLimitKBps: null,
          downloadLimitKBps: null,
          pausedUntil: null,
          startAtLogin: true,
          setupSkipped: false,
          updateChannel: "auto",
          confirmStopSync: true,
        },
        status: {
          state: "syncing",
          uploadSpeed: 18 * MB,
          uploadRemainingBytes: 214 * MB,
          pendingFiles: 23,
          pendingBytes: 214 * MB,
          movedBytes: 296 * MB,
          uncheckedFolders: 0,
          waitingFiles: { next: [], biggest: [] },
          fileCount: 1284,
          conflicts: [],
          issues: [],
          lastSyncAt: minutes(1),
          folderSizes: {},
          activity: [
            activity(
              "renovation",
              "Kitchen walkthrough.mp4",
              "up",
              148 * MB,
              98 * MB,
              minutes(0),
            ),
            activity(
              "renovation",
              "Attic room.jpg",
              "up",
              4.1 * MB,
              1.2 * MB,
              minutes(0),
            ),
            activity(
              "renovation",
              "Sage paint.jpg",
              "up",
              3.8 * MB,
              3.8 * MB,
              minutes(1),
            ),
            activity(
              "renovation",
              "Study window.jpg",
              "up",
              4.4 * MB,
              4.4 * MB,
              minutes(1),
            ),
            activity(
              "documents",
              "Mortgage statement 2026.pdf",
              "down",
              0.6 * MB,
              0.6 * MB,
              minutes(4),
            ),
            activity(
              "music",
              "Piano practice.m4a",
              "down",
              7.2 * MB,
              7.2 * MB,
              minutes(12),
            ),
            activity(
              "photos",
              "Lisbon 2026/IMG_4255.jpg",
              "up",
              4.1 * MB,
              4.1 * MB,
              minutes(26),
            ),
          ],
        },
      };
      const done = async () => {};
      const api: DesktopApi = {
        getState: async () => state,
        onState: () => () => {},
        connect: async () => ({ error: null }),
        refreshProfile: done,
        serverFolders: async () => ({ error: "Not in the brand kit." }),
        chooseFolder: async () => null,
        folderWarning: async () => null,
        localFolders: async () => [],
        createServerFolder: async () => ({ error: "Not in the brand kit." }),
        savePairs: async () => ({ error: null }),
        editPair: async () => ({ error: null }),
        updateSettings: done,
        pause: done,
        openStaaash: async () => ({ error: null }),
        openFolder: done,
        openSyncLog: done,
        syncNow: done,
        resolveConflict: done,
        resolvePair: done,
        takeCommand: async () => null,
        onCommand: () => () => {},
        installUpdate: done,
        checkForUpdates: async () => "current",
        signOut: done,
        quit: done,
      };
      Object.assign(window, { staaash: api });
    },
    { port: process.env.STAAASH_DESKTOP_UI_PORT!, MB },
  );
}
