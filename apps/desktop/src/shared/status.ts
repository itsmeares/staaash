import { formatBytes } from "@/lib/format-bytes";

import type { AppState, EngineStatus } from "./types";

const longerUploadTime = (minutes: number) => {
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const rest = minutes % 60;
    return `${hours} hr${rest ? ` ${rest} min` : ""}`;
  }
  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  return `${days} day${days === 1 ? "" : "s"}${rest ? ` ${rest} hr` : ""}`;
};

export const uploadTimeLeft = (bytes: number, speed: number) => {
  if (bytes <= 0 || speed <= 0) return "";
  const seconds = Math.max(1, Math.round(bytes / speed));
  if (seconds < 60) return `~${seconds} sec left`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `~${minutes} min left`;
  return `~${longerUploadTime(minutes)} left`;
};

/** "4.1 GB left · checking 2 more folders", under the syncing line. */
export const syncDetail = (status: EngineStatus) => {
  const folders = status.uncheckedFolders;
  return [
    status.pendingBytes ? `${formatBytes(status.pendingBytes)} left` : "",
    folders ? `checking ${folders} more folder${folders === 1 ? "" : "s"}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
};

/** One line for the tray menu and its tooltip, which add the bytes left. */
// One line per engine state.
// fallow-ignore-next-line complexity
export const statusLine = (state: AppState, withBytes = false) => {
  if (state.versionProblem) {
    return state.versionProblem.side === "server"
      ? "Server needs an update"
      : "Update this app to keep syncing";
  }
  if (!state.signedIn) return "Not signed in";
  const status = state.status;
  if (!status) return "Starting…";
  const attention = status.conflicts.length + status.issues.length;
  switch (status.state) {
    case "paused":
      return "Paused";
    case "offline":
      return "Can't reach the server";
    case "problem":
      return "Sync hit a problem";
    case "signed-out":
      return "Signed out";
    case "syncing":
    case "starting":
      if (!status.pendingFiles) return "Checking for changes…";
      return `Syncing ${status.pendingFiles.toLocaleString()} file${status.pendingFiles === 1 ? "" : "s"}${
        withBytes && status.pendingBytes
          ? ` · ${formatBytes(status.pendingBytes)} left`
          : ""
      }`;
    default:
      return attention
        ? `${attention} item${attention === 1 ? "" : "s"} need${attention === 1 ? "s" : ""} you`
        : `Up to date · ${status.fileCount.toLocaleString()} files`;
  }
};
