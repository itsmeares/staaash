import { app, shell } from "electron";
import electronUpdater from "electron-updater";

import { newestRelease, newerRelease } from "../shared/version";

const RELEASES = "https://github.com/itsmeares/staaash/releases";
const CHECK_MS = 6 * 60 * 60_000;

export type UpdateState = { version: string; ready: boolean; manual: boolean };
export type UpdateCheck = "found" | "current" | "failed";

/**
 * Windows and Linux update themselves from GitHub releases. macOS updates
 * need a signed app, which Staaash does not have, so the Mac app only says
 * a new version exists and opens the download page.
 */
export const startUpdates = (
  onChange: (update: UpdateState) => void,
  releaseCandidates: boolean,
) => {
  if (!app.isPackaged)
    return {
      install: async () => {},
      check: async (): Promise<UpdateCheck> => "current",
      setReleaseCandidates: (_on: boolean) => {},
    };
  const manual = process.platform === "darwin";
  let includeCandidates = releaseCandidates;
  let latest: string | null = null;

  if (manual) {
    const check = async (): Promise<UpdateCheck> => {
      try {
        const response = await fetch(
          "https://api.github.com/repos/itsmeares/staaash/releases",
          { headers: { accept: "application/vnd.github+json" } },
        );
        if (!response.ok) return "failed";
        const version = newestRelease(
          (await response.json()) as Parameters<typeof newestRelease>[0],
          includeCandidates,
        );
        if (!version || !newerRelease(version, app.getVersion()))
          return "current";
        latest = version;
        onChange({ version, ready: true, manual });
        return "found";
      } catch {
        return "failed";
      }
    };
    void check();
    setInterval(check, CHECK_MS);
    return {
      install: async () => {
        await shell.openExternal(
          latest ? `${RELEASES}/tag/v${latest}` : RELEASES,
        );
      },
      check,
      setReleaseCandidates: (on: boolean) => {
        includeCandidates = on;
        void check();
      },
    };
  }

  const { autoUpdater } = electronUpdater;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = includeCandidates;
  autoUpdater.on("update-available", (info) =>
    onChange({ version: info.version, ready: false, manual }),
  );
  autoUpdater.on("update-downloaded", (info) =>
    onChange({ version: info.version, ready: true, manual }),
  );
  autoUpdater.on("error", () => {
    // Offline or no release for this platform yet; the next check retries.
  });
  const check = async (): Promise<UpdateCheck> => {
    try {
      const result = await autoUpdater.checkForUpdates();
      return result?.isUpdateAvailable ? "found" : "current";
    } catch {
      return "failed";
    }
  };
  void check();
  setInterval(check, CHECK_MS);
  return {
    install: async () => autoUpdater.quitAndInstall(),
    check,
    setReleaseCandidates: (on: boolean) => {
      autoUpdater.allowPrerelease = on;
      void check();
    },
  };
};
