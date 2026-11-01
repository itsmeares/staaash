import type { AppState } from "./types";

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

/** One line for the tray menu, and its tooltip. */
// One line per engine state.
// fallow-ignore-next-line complexity
export const statusLine = (state: AppState) => {
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
      return status.pendingFiles
        ? `Syncing ${status.pendingFiles} file${status.pendingFiles === 1 ? "" : "s"}`
        : "Checking for changes…";
    default:
      return attention
        ? `${attention} item${attention === 1 ? "" : "s"} need${attention === 1 ? "s" : ""} you`
        : `Up to date · ${status.fileCount.toLocaleString()} files`;
  }
};
