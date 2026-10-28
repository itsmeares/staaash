import {
  ArrowDown,
  ArrowUp,
  CircleAlert,
  FolderOpen,
  Pause,
  Play,
  Settings,
  TriangleAlert,
} from "lucide-react";

import { DriveGlyph } from "@/components/drive-glyph";
import { formatBytes } from "@/lib/format-bytes";
import { Button } from "@staaash/ui/components/button";
import { Progress } from "@staaash/ui/components/progress";
import { ScrollArea } from "@staaash/ui/components/scroll-area";

import { statusLine } from "../shared/status";
import type { Activity, AppState, Conflict, Issue } from "../shared/types";
import { desktop, useAppState } from "./state";

const fileName = (rel: string) => rel.slice(rel.lastIndexOf("/") + 1);

function IssueRow({ issue }: { issue: Issue }) {
  const emptied = issue.kind === "folder-emptied";
  return (
    <li className="grid gap-2 px-4 py-3">
      <div className="flex gap-2.5">
        <TriangleAlert
          aria-hidden
          className="mt-0.5 size-4 shrink-0 text-warning-foreground"
        />
        <div className="min-w-0">
          {issue.rel ? (
            <p className="m-0 truncate text-body font-medium">
              {fileName(issue.rel)}
            </p>
          ) : null}
          <p className="m-0 text-meta text-muted-foreground">{issue.message}</p>
        </div>
      </div>
      {emptied ? (
        <div className="flex gap-2 ps-6.5">
          <Button
            size="xs"
            variant="outline"
            onClick={() =>
              void desktop.resolvePair(issue.pairId, "download-again")
            }
          >
            Bring them back
          </Button>
          <Button
            size="xs"
            variant="ghost-destructive"
            onClick={() => void desktop.resolvePair(issue.pairId, "apply")}
          >
            Delete them
          </Button>
        </div>
      ) : issue.kind === "invalid-name" ? (
        <div className="ps-6.5">
          <Button
            size="xs"
            variant="outline"
            onClick={() => void desktop.openStaaash()}
          >
            Rename on the server
          </Button>
        </div>
      ) : issue.kind === "symlink" || issue.kind === "error" ? null : (
        <div className="ps-6.5">
          <Button
            size="xs"
            variant="outline"
            onClick={() => void desktop.openSettings()}
          >
            Open settings
          </Button>
        </div>
      )}
    </li>
  );
}

function ActivityRow({ activity }: { activity: Activity }) {
  const Icon = activity.direction === "up" ? ArrowUp : ArrowDown;
  const percent = activity.bytes
    ? Math.min(100, (activity.doneBytes / activity.bytes) * 100)
    : 100;
  return (
    <li>
      <button
        className="flex w-full items-center gap-2.5 px-4 py-2 text-start hover:bg-hover focus-visible:bg-hover focus-visible:outline-none"
        type="button"
        onClick={() => void desktop.openFolder(activity.pairId, activity.rel)}
      >
        <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-body">
            {fileName(activity.rel)}
          </span>
          {activity.state === "active" ? (
            <Progress
              aria-label={`${fileName(activity.rel)} progress`}
              className="mt-1"
              value={percent}
            />
          ) : (
            <span className="block text-label text-muted-foreground">
              {activity.state === "failed"
                ? "Failed"
                : `${activity.direction === "up" ? "Uploaded" : "Downloaded"} · ${formatBytes(activity.bytes)}`}
            </span>
          )}
        </span>
      </button>
    </li>
  );
}

function ConflictRow({ conflict }: { conflict: Conflict }) {
  return (
    <li className="grid gap-2 px-4 py-3">
      <div className="flex gap-2.5">
        <CircleAlert
          aria-hidden
          className="mt-0.5 size-4 shrink-0 text-warning-foreground"
        />
        <div className="min-w-0">
          <p className="m-0 truncate text-body font-medium">
            {fileName(conflict.rel)}
          </p>
          <p className="m-0 text-meta text-muted-foreground">
            Changed here and on the server. Both versions were kept.
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 ps-6.5">
        <Button
          size="xs"
          variant="outline"
          onClick={() =>
            void desktop.resolveConflict(conflict.id, "keep-server")
          }
        >
          Keep server version
        </Button>
        <Button
          size="xs"
          variant="outline"
          onClick={() => void desktop.resolveConflict(conflict.id, "keep-mine")}
        >
          Keep mine
        </Button>
        <Button
          size="xs"
          variant="ghost"
          onClick={() =>
            void desktop.openFolder(conflict.pairId, conflict.copyRel)
          }
        >
          Show both
        </Button>
      </div>
    </li>
  );
}

/** Messages above the lists: an update, or why nothing syncs yet. */
function Notices({ state }: { state: AppState }) {
  return (
    <>
      {state.update?.ready ? (
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <p className="m-0 flex-1 text-body">
            Version {state.update.version} is ready.
          </p>
          <Button size="xs" onClick={() => void desktop.installUpdate()}>
            {state.update.manual ? "Download" : "Restart to update"}
          </Button>
        </div>
      ) : null}
      {!state.signedIn || state.versionProblem ? (
        <div className="grid justify-items-start gap-3 p-4">
          <p className="m-0 text-body text-foreground/80">
            {state.versionProblem
              ? "Syncing is stopped until the versions match. Settings explains what to update."
              : "Sign in to start syncing."}
          </p>
          <Button size="sm" onClick={() => void desktop.openSettings()}>
            Open settings
          </Button>
        </div>
      ) : null}
    </>
  );
}

function Footer({ state }: { state: AppState }) {
  const paused = state.status?.state === "paused";
  const first = state.settings.pairs[0];
  return (
    <footer className="flex items-center gap-2 p-3">
      <Button
        className="flex-1"
        disabled={!state.signedIn}
        onClick={() => void desktop.openStaaash()}
      >
        Open Staaash
      </Button>
      <Button
        aria-label="Open synced folder"
        disabled={!first}
        size="icon"
        variant="outline"
        onClick={() => first && void desktop.openFolder(first.id)}
      >
        <FolderOpen />
      </Button>
      <Button
        aria-label={paused ? "Resume syncing" : "Pause syncing until resumed"}
        disabled={!state.signedIn}
        size="icon"
        variant="outline"
        onClick={() => void desktop.pause(paused ? null : 0)}
      >
        {paused ? <Play /> : <Pause />}
      </Button>
    </footer>
  );
}

/** The window behind the tray icon: what is happening, and what needs you. */
// Optional status fields; each read is one branch.
// fallow-ignore-next-line complexity
export function Panel() {
  const state = useAppState();
  if (!state) return null;
  const conflicts = state.status?.conflicts ?? [];
  const issues = state.status?.issues ?? [];
  const activity = state.status?.activity ?? [];
  const attention = conflicts.length + issues.length;
  const quiet = state.signedIn && attention === 0 && !state.versionProblem;

  return (
    <div className="flex h-screen flex-col overflow-hidden border border-border bg-popover text-popover-foreground">
      <header className="flex items-center gap-3 px-4 pt-4 pb-3">
        <DriveGlyph className="w-7" />
        <div className="min-w-0 flex-1">
          <h1 className="m-0 font-heading text-headline leading-tight font-medium">
            Staaash
          </h1>
          <p
            className="m-0 truncate text-meta text-muted-foreground"
            role="status"
          >
            {statusLine(state)}
          </p>
        </div>
        <Button
          aria-label="Settings"
          size="icon-sm"
          variant="ghost-muted"
          onClick={() => void desktop.openSettings()}
        >
          <Settings />
        </Button>
      </header>

      <ScrollArea className="min-h-0 flex-1 border-y border-border">
        <Notices state={state} />
        {attention > 0 ? (
          <section aria-label="Needs you">
            <ul className="m-0 list-none divide-y divide-border p-0">
              {conflicts.map((conflict) => (
                <ConflictRow conflict={conflict} key={conflict.id} />
              ))}
              {issues.map((issue) => (
                <IssueRow
                  issue={issue}
                  key={`${issue.pairId}:${issue.kind}:${issue.rel}`}
                />
              ))}
            </ul>
          </section>
        ) : null}
        {activity.length > 0 ? (
          <section
            aria-label="Recent activity"
            className={attention > 0 ? "border-t border-border" : undefined}
          >
            <ul className="m-0 list-none p-0 py-1">
              {activity.map((each) => (
                <ActivityRow
                  activity={each}
                  key={`${each.pairId}:${each.rel}`}
                />
              ))}
            </ul>
          </section>
        ) : quiet ? (
          <p className="m-0 px-4 py-8 text-center text-body text-muted-foreground">
            Files you change show up here while they sync.
          </p>
        ) : null}
      </ScrollArea>

      <Footer state={state} />
    </div>
  );
}
