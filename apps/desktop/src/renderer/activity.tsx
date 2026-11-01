import {
  Activity as ActivityIcon,
  ArrowDown,
  ArrowUp,
  Check,
  CircleAlert,
  Pause,
  TriangleAlert,
  WifiOff,
} from "lucide-react";

import { formatBytes } from "@/lib/format-bytes";
import { Button } from "@staaash/ui/components/button";
import { ItemTypeIcon } from "@staaash/ui/item-type-icon";
import { getItemVisual } from "@staaash/ui/item-visuals";

import { statusLine } from "../shared/status";
import type { Activity, AppState, Conflict, Issue } from "../shared/types";
import { PauseButton } from "./pause";
import type { Page } from "./shell";
import { desktop } from "./state";

const fileName = (rel: string) => rel.slice(rel.lastIndexOf("/") + 1);

// Only the file's look depends on this, so the common types are enough.
const MIME_BY_EXTENSION: [RegExp, string][] = [
  [/\.(png|jpe?g|gif|webp|avif|svg)$/i, "image/"],
  [/\.(mp4|mov|mkv|webm|avi)$/i, "video/"],
  [/\.(mp3|flac|wav|ogg|m4a)$/i, "audio/"],
  [/\.pdf$/i, "pdf"],
  [/\.(txt|md|docx?|odt|rtf|json|csv)$/i, "text/"],
  [/\.(zip|tar|gz|7z|rar)$/i, "zip"],
];
const fileVisual = (rel: string) =>
  getItemVisual(
    "file",
    MIME_BY_EXTENSION.find(([pattern]) => pattern.test(rel))?.[1],
    fileName(rel),
  );

const ago = (at: number) => {
  const minutes = Math.floor((Date.now() - at) / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours} hr ago` : `${Math.floor(hours / 24)} d ago`;
};

// Each kind of problem offers its own way out.
// fallow-ignore-next-line complexity
function IssueRow({
  issue,
  onNavigate,
}: {
  issue: Issue;
  onNavigate: (page: Page) => void;
}) {
  const emptied = issue.kind === "folder-emptied";
  return (
    <li className="mx-3 mb-2 grid gap-2 rounded-xl bg-warning/8 px-4 py-3">
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
      ) : issue.kind === "quota" ? (
        <div className="ps-6.5">
          <Button
            size="xs"
            variant="outline"
            onClick={() => void desktop.openStaaash()}
          >
            Open drive
          </Button>
        </div>
      ) : issue.kind === "error" ? null : (
        <div className="ps-6.5">
          <Button
            size="xs"
            variant="outline"
            onClick={() =>
              onNavigate(issue.kind === "disk-full" ? "settings" : "folders")
            }
          >
            {issue.kind === "disk-full" ? "Open settings" : "Open folders"}
          </Button>
        </div>
      )}
    </li>
  );
}

function ActivityRow({
  activity,
  folder,
}: {
  activity: Activity;
  folder: string;
}) {
  const Direction = activity.direction === "up" ? ArrowUp : ArrowDown;
  const active = activity.state === "active";
  const percent = activity.bytes
    ? Math.min(100, Math.round((activity.doneBytes / activity.bytes) * 100))
    : 100;
  const name = fileName(activity.rel);
  const inside = activity.rel.slice(0, -name.length - 1);
  return (
    <li>
      <button
        className="flex w-full cursor-pointer items-center gap-3 border-0 bg-transparent px-5 py-2 text-start text-foreground hover:bg-hover focus-visible:bg-hover focus-visible:outline-none"
        type="button"
        onClick={() => void desktop.openFolder(activity.pairId, activity.rel)}
      >
        <ItemTypeIcon
          className="grid size-8.5 shrink-0 place-items-center rounded-[0.625rem]"
          size={17}
          visual={fileVisual(activity.rel)}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-body font-medium">{name}</span>
          <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-label text-muted-foreground">
            <Direction aria-hidden className="size-3 shrink-0" />
            <span className="truncate">
              {inside ? `${folder}/${inside}` : folder}
            </span>
          </span>
        </span>
        {active ? (
          <span className="w-24 shrink-0 max-[37.5rem]:w-16">
            <span className="block h-1 overflow-hidden rounded-full bg-foreground/8">
              <span
                className="block h-full rounded-full bg-primary"
                style={{ width: `${percent}%` }}
              />
            </span>
            <span className="mt-1 block text-end text-label whitespace-nowrap text-muted-foreground">
              {percent}%
              <span className="max-[37.5rem]:hidden">
                {" "}
                of {formatBytes(activity.bytes)}
              </span>
            </span>
          </span>
        ) : (
          <span className="shrink-0 text-end">
            <span className="block text-meta">
              {activity.state === "failed"
                ? "Failed"
                : formatBytes(activity.bytes)}
            </span>
            <span className="mt-0.5 block text-label text-muted-foreground">
              {ago(activity.at)}
            </span>
          </span>
        )}
      </button>
    </li>
  );
}

function ConflictRow({ conflict }: { conflict: Conflict }) {
  return (
    <li className="mx-3 mb-2 grid gap-2 rounded-xl bg-warning/8 px-4 py-3">
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

function UpdateNotice({ state }: { state: AppState }) {
  if (!state.update?.ready) return null;
  return (
    <div className="flex items-center gap-2 border-b border-border px-5 py-3">
      <p className="m-0 flex-1 text-body">
        Version {state.update.version} is ready.
      </p>
      <Button size="xs" onClick={() => void desktop.installUpdate()}>
        {state.update.manual ? "Download" : "Restart to update"}
      </Button>
    </div>
  );
}

/** The headline's icon, colour and second line for the current state. */
// One look per engine state.
// fallow-ignore-next-line complexity
const headline = (state: AppState) => {
  const status = state.status;
  const attention =
    (status?.conflicts.length ?? 0) + (status?.issues.length ?? 0);
  if (status?.state === "paused") {
    const until = state.settings.pausedUntil;
    return {
      Icon: Pause,
      color: "var(--muted-foreground)",
      title: "Syncing is paused",
      detail: until
        ? `Until ${new Date(until).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}`
        : "Until you resume",
    };
  }
  if (status?.state === "offline") {
    return {
      Icon: WifiOff,
      color: "var(--muted-foreground)",
      title: "Can't reach the server",
      detail: "Syncing continues when it's back.",
    };
  }
  if (status?.state === "problem") {
    return {
      Icon: TriangleAlert,
      color: "var(--warning)",
      title: statusLine(state),
      detail: "Syncing tries again soon.",
    };
  }
  if (status?.state === "syncing" || status?.state === "starting") {
    return {
      Icon: ActivityIcon,
      color: "var(--primary)",
      title: statusLine(state),
      detail: status.pendingBytes
        ? `${formatBytes(status.pendingBytes)} left`
        : "",
    };
  }
  if (attention) {
    return {
      Icon: TriangleAlert,
      color: "var(--warning)",
      title: statusLine(state),
      detail: "Everything else is up to date.",
    };
  }
  return {
    Icon: Check,
    color: "var(--success)",
    title: "Everything is up to date",
    detail: `${(status?.fileCount ?? 0).toLocaleString()} files`,
  };
};

/** What is happening, and what needs you. */
// Optional status fields; each read is one branch.
// fallow-ignore-next-line complexity
export function ActivityPage({
  state,
  onNavigate,
  onCustomPause,
}: {
  state: AppState;
  onNavigate: (page: Page) => void;
  onCustomPause: () => void;
}) {
  const conflicts = state.status?.conflicts ?? [];
  const issues = state.status?.issues ?? [];
  const activity = state.status?.activity ?? [];
  const running = activity.filter((each) => each.state === "active");
  const recent = activity.filter((each) => each.state !== "active");
  const total = running.reduce((sum, each) => sum + each.bytes, 0);
  const done = running.reduce((sum, each) => sum + each.doneBytes, 0);
  const { Icon, color, title, detail } = headline(state);
  const folderOf = (pairId: string) => {
    const label = state.settings.pairs.find(
      (pair) => pair.id === pairId,
    )?.remoteLabel;
    return label === "Your whole drive" ? "Your drive" : (label ?? "");
  };
  const group =
    "m-0 px-5 pt-3.5 pb-1.5 text-label font-medium text-muted-foreground";

  return (
    <>
      <header className="flex items-center gap-3.5 px-5 pt-4.5 pb-4">
        <span
          className="grid size-10.5 shrink-0 place-items-center rounded-xl"
          style={{
            color,
            background: `color-mix(in oklab, ${color} 15%, transparent)`,
          }}
        >
          <Icon aria-hidden className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h1
            className="m-0 font-heading text-headline font-medium"
            role="status"
          >
            {title}
          </h1>
          {detail ? (
            <p className="m-0 mt-0.5 text-meta text-muted-foreground">
              {detail}
            </p>
          ) : null}
        </div>
        {/* Stacked on narrow windows, or the buttons squeeze the title. */}
        <div className="flex shrink-0 items-center gap-2 max-sm:flex-col max-sm:items-end">
          {state.status?.state === "problem" ? (
            <Button
              variant="outline"
              onClick={() => void desktop.openSyncLog()}
            >
              Open log
            </Button>
          ) : null}
          <PauseButton
            paused={state.status?.state === "paused"}
            onCustom={onCustomPause}
          />
        </div>
      </header>
      <div className="h-0.5 shrink-0 bg-border">
        {total > 0 ? (
          <div
            className="h-full bg-primary"
            style={{ width: `${(done / total) * 100}%` }}
          />
        ) : null}
      </div>
      <div className="min-h-0 flex-1 scrollbar-thin overflow-y-auto pb-3">
        <UpdateNotice state={state} />
        {conflicts.length + issues.length > 0 ? (
          <ul aria-label="Needs you" className="m-0 list-none p-0 pt-3">
            {conflicts.map((conflict) => (
              <ConflictRow conflict={conflict} key={conflict.id} />
            ))}
            {issues.map((issue) => (
              <IssueRow
                issue={issue}
                key={`${issue.pairId}:${issue.kind}:${issue.rel}`}
                onNavigate={onNavigate}
              />
            ))}
          </ul>
        ) : null}
        {running.length > 0 ? (
          <section>
            <h2 className={group}>Now</h2>
            <ul className="m-0 list-none p-0">
              {running.map((each) => (
                <ActivityRow
                  activity={each}
                  folder={folderOf(each.pairId)}
                  key={`${each.pairId}:${each.rel}`}
                />
              ))}
            </ul>
          </section>
        ) : null}
        {recent.length > 0 ? (
          <section>
            <h2 className={group}>Recent</h2>
            <ul className="m-0 list-none p-0">
              {recent.map((each) => (
                <ActivityRow
                  activity={each}
                  folder={folderOf(each.pairId)}
                  key={`${each.pairId}:${each.rel}`}
                />
              ))}
            </ul>
          </section>
        ) : running.length === 0 ? (
          <p className="m-0 px-5 py-8 text-center text-body text-muted-foreground">
            Files you change show up here while they sync.
          </p>
        ) : null}
      </div>
    </>
  );
}
