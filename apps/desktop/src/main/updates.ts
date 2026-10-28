import { app, shell } from "electron";
import electronUpdater from "electron-updater";

import { newer } from "../shared/version";

const RELEASES = "https://github.com/itsmeares/staaash/releases";
const CHECK_MS = 6 * 60 * 60_000;

export type UpdateState = { version: string; ready: boolean; manual: boolean };

/**
 * Windows and Linux update themselves from GitHub releases. macOS updates
 * need a signed app, which Staaash does not have, so the Mac app only says
 * a new version exists and opens the download page.
 */
export const startUpdates = (onChange: (update: UpdateState) => void) => {
  if (!app.isPackaged) return { install: async () => {} };
  const manual = process.platform === "darwin";
  let latest: string | null = null;

  if (manual) {
    const check = async () => {
      try {
        const response = await fetch(
          "https://api.github.com/repos/itsmeares/staaash/releases/latest",
          { headers: { accept: "application/vnd.github+json" } },
        );
        const release = (await response.json()) as { tag_name?: string };
        const version = release.tag_name?.replace(/^v/, "");
        if (version && newer(version, app.getVersion())) {
          latest = version;
          onChange({ version, ready: true, manual });
        }
      } catch {
        // Offline; the next check tries again.
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
    };
  }

  const { autoUpdater } = electronUpdater;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on("update-available", (info) =>
    onChange({ version: info.version, ready: false, manual }),
  );
  autoUpdater.on("update-downloaded", (info) =>
    onChange({ version: info.version, ready: true, manual }),
  );
  autoUpdater.on("error", () => {
    // Offline or no release for this platform yet; the next check retries.
  });
  const check = () => void autoUpdater.checkForUpdates().catch(() => {});
  check();
  setInterval(check, CHECK_MS);
  return { install: async () => autoUpdater.quitAndInstall() };
};
