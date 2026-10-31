import type { AppState } from "./types";

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
