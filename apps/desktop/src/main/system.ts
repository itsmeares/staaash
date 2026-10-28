import { existsSync, readFileSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { app } from "electron";

const home = os.homedir();

const desktopEntry = (exec: string, extra = "") => `[Desktop Entry]
Type=Application
Name=Staaash
Comment=Sync files with your Staaash drive
Exec="${exec}"${extra}
Icon=staaash
Terminal=false
Categories=Network;FileTransfer;
${extra ? "X-GNOME-Autostart-enabled=true\n" : ""}`;

/** Linux autostart is a desktop file; Windows and macOS have a setting. */
export const setStartAtLogin = async (enabled: boolean) => {
  if (!app.isPackaged) return;
  if (process.platform !== "linux") {
    // Windows passes the flag; macOS reports wasOpenedAtLogin instead.
    app.setLoginItemSettings({ openAtLogin: enabled, args: ["--hidden"] });
    return;
  }
  const file = path.join(home, ".config", "autostart", "staaash.desktop");
  if (!enabled) {
    await rm(file, { force: true });
    return;
  }
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(
    file,
    desktopEntry(process.env.APPIMAGE ?? process.execPath, " --hidden"),
  );
};

/**
 * An AppImage has no installer, so it adds its own menu entry and icon on
 * first run, pointing at wherever the AppImage file now lives.
 */
export const installLinuxMenuEntry = async () => {
  const appImage = process.env.APPIMAGE;
  if (process.platform !== "linux" || !appImage) return;
  const share = path.join(home, ".local", "share");
  const icon = path.join(
    share,
    "icons",
    "hicolor",
    "512x512",
    "apps",
    "staaash.png",
  );
  await mkdir(path.dirname(icon), { recursive: true });
  await writeFile(
    icon,
    readFileSync(path.join(process.resourcesPath, "icon.png")),
  );
  const entry = path.join(share, "applications", "staaash.desktop");
  await mkdir(path.dirname(entry), { recursive: true });
  await writeFile(entry, desktopEntry(appImage));
};

/** Folders other sync apps own. Two sync apps on one folder fight. */
const otherSyncRoots = () => {
  const roots: { name: string; path: string }[] = [];
  const add = (name: string, folder: string | undefined) => {
    if (folder) roots.push({ name, path: path.resolve(folder) });
  };
  add("OneDrive", process.env.OneDrive);
  add("OneDrive", process.env.OneDriveConsumer);
  add("OneDrive", process.env.OneDriveCommercial);
  add("iCloud Drive", path.join(home, "Library", "Mobile Documents"));
  if (
    process.platform === "darwin" &&
    existsSync(
      path.join(home, "Library", "Mobile Documents", "com~apple~CloudDocs"),
    )
  ) {
    // iCloud's "Desktop & Documents Folders" option syncs these two.
    add(
      "iCloud Drive (if Desktop & Documents sync is on)",
      path.join(home, "Desktop"),
    );
    add(
      "iCloud Drive (if Desktop & Documents sync is on)",
      path.join(home, "Documents"),
    );
  }
  try {
    const info = JSON.parse(
      readFileSync(path.join(home, ".dropbox", "info.json"), "utf8"),
    ) as Record<string, { path?: string }>;
    for (const account of Object.values(info)) add("Dropbox", account.path);
  } catch {
    // No Dropbox here.
  }
  add("A cloud storage app", path.join(home, "Library", "CloudStorage"));
  add("Google Drive", path.join(home, "Google Drive"));
  add("Google Drive", path.join(home, "My Drive"));
  return roots;
};

const contains = (folder: string, child: string) => {
  const relative = path.relative(folder, child);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
};

/** A warning when the folder sits inside, or holds, another app's synced folder. */
export const otherSyncAppWarning = (localPath: string) => {
  const target = path.resolve(localPath);
  const hit = otherSyncRoots().find(
    (root) => contains(root.path, target) || contains(target, root.path),
  );
  return hit
    ? `${hit.name} may already sync this folder. Two sync apps on one folder can make duplicate copies.`
    : null;
};

export const foldersOverlap = (a: string, b: string) =>
  contains(path.resolve(a), path.resolve(b)) ||
  contains(path.resolve(b), path.resolve(a));
