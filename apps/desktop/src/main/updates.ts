import { app, shell } from "electron";
import electronUpdater from "electron-updater";

import { newestRelease, newerRelease } from "../shared/version";

const RELEASES = "https://github.com/itsmeares/staaash/releases";
const CHECK_MS = 6 * 60 * 60_000;

export type UpdateState = { version: string; ready: boolean; manual: boolean };
export type UpdateCheck = "found" | "current" | "failed";
type Release = Parameters<typeof newestRelease>[0][number];

/**
 * Windows and Linux update themselves from GitHub releases. macOS updates
 * need a signed app, which Staaash does not have, so the Mac app only says
 * a new version exists and opens the download page.
 */
export const startUpdates = (
  onChange: (update: UpdateState | null) => void,
  releaseCandidates: boolean,
  onAppImageMoved: (file: string) => void = () => {},
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
  /** Leaving candidates drops a candidate already found, so the channel wins. */
  const dropCandidate = () => {
    if (!latest?.includes("-")) return false;
    latest = null;
    onChange(null);
    return true;
  };

  if (manual) {
    const check = async (): Promise<UpdateCheck> => {
      try {
        // The list's first page always holds the newest release, but a long
        // run of candidates can push every stable one past it.
        const response = await fetch(
          `https://api.github.com/repos/itsmeares/staaash/releases${includeCandidates ? "" : "/latest"}`,
          { headers: { accept: "application/vnd.github+json" } },
        );
        if (!response.ok) return "failed";
        const body = (await response.json()) as Release | Release[];
        const version = newestRelease(
          Array.isArray(body) ? body : [body],
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
        if (!on) dropCandidate();
        void check();
      },
    };
  }

  const { autoUpdater } = electronUpdater;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = includeCandidates;
  // A candidate found before the channel changed can still finish later.
  const unwanted = (version: string) =>
    version.includes("-") && !autoUpdater.allowPrerelease;
  autoUpdater.on("update-available", (info) => {
    if (unwanted(info.version)) return;
    latest = info.version;
    onChange({ version: info.version, ready: false, manual });
  });
  autoUpdater.on("update-downloaded", (info) => {
    // Decided here, not when the check started, since the channel may change.
    autoUpdater.autoInstallOnAppQuit = !unwanted(info.version);
    if (unwanted(info.version)) return;
    latest = info.version;
    onChange({ version: info.version, ready: true, manual });
  });
  autoUpdater.on("appimage-filename-updated", onAppImageMoved);
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
      // The downloaded candidate stays on disk; it just must not install.
      if (!on && dropCandidate()) autoUpdater.autoInstallOnAppQuit = false;
      void check();
    },
  };
};
