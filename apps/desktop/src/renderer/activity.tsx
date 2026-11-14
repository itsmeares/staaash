import {
  Activity as ActivityIcon,
  ArrowDown,
  ArrowUp,
  Check,
  CircleAlert,
  Clock,
  FolderOpen,
  Info,
  Pause,
  RotateCw,
  TriangleAlert,
  WifiOff,
} from "lucide-react";

import { formatBytes } from "@/lib/format-bytes";
import { Button } from "@staaash/ui/components/button";
import {
  ContextMenu,
  ContextMenuItem,
  ContextMenuPopup,
  ContextMenuTrigger,
} from "@staaash/ui/components/context-menu";
import {
  Popover,
  PopoverPopup,
  PopoverTrigger,
} from "@staaash/ui/components/popover";
import { ItemTypeIcon } from "@staaash/ui/item-type-icon";
import { getItemVisual } from "@staaash/ui/item-visuals";

import { statusLine, syncDetail, uploadTimeLeft } from "../shared/status";
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
  paused = false,
}: {
  activity: Activity;
  folder: string;
  paused?: boolean;
}) {
  const Direction = activity.direction === "up" ? ArrowUp : ArrowDown;
  const name = fileName(activity.rel);
  const inside = activity.rel.slice(0, -name.length - 1);
  const stopped = activity.state === "failed" || activity.state === "waiting";
  const open = () => void desktop.openFolder(activity.pairId, activity.rel);
  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={
          <li className="flex items-center gap-3 px-5 py-2 hover:bg-hover has-focus-visible:bg-hover" />
        }
      >
        {/* The status sits outside the button: its info icon is a button too. */}
        <button
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 border-0 bg-transparent p-0 text-start text-foreground focus-visible:outline-none"
          type="button"
          onClick={open}
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
        </button>
        {activity.state === "active" ? (
          <ActivityProgress activity={activity} />
        ) : (
          <ActivityEnd activity={activity} />
        )}
      </ContextMenuTrigger>
      <ContextMenuPopup>
        {stopped ? (
          <ContextMenuItem
            disabled={paused}
            onClick={() => void desktop.syncNow()}
          >
            <RotateCw aria-hidden />
            {paused ? "Resume sync to retry" : "Retry"}
          </ContextMenuItem>
        ) : null}
        <ContextMenuItem onClick={open}>
          <FolderOpen aria-hidden />
          Show in folder
        </ContextMenuItem>
      </ContextMenuPopup>
    </ContextMenu>
  );
}

const ended: Partial<
  Record<Activity["state"], { label: string; tone: string }>
> = {
  failed: { label: "Failed", tone: "text-destructive-foreground" },
  waiting: { label: "Waiting", tone: "text-muted-foreground" },
};

function ActivityEnd({ activity }: { activity: Activity }) {
  const stopped = ended[activity.state];
  return (
    <span className="shrink-0 text-end">
      <span
        className={`flex items-center justify-end gap-1 text-meta ${stopped?.tone ?? ""}`}
      >
        {stopped?.label ?? formatBytes(activity.bytes)}
        {stopped && activity.reason ? (
          <ReasonInfo reason={activity.reason} />
        ) : null}
      </span>
      <span className="mt-0.5 block text-label text-muted-foreground">
        {ago(activity.at)}
      </span>
    </span>
  );
}

function ReasonInfo({ reason }: { reason: string }) {
  return (
    <Popover>
      <PopoverTrigger
        aria-label={`Why: ${reason}`}
        className="grid size-5 cursor-pointer place-items-center rounded-full border-0 bg-transparent p-0 text-inherit hover:bg-foreground/8 focus-visible:bg-foreground/8 focus-visible:outline-none"
        delay={100}
        openOnHover
      >
        <Info aria-hidden className="size-3.5" />
      </PopoverTrigger>
      <PopoverPopup align="end" className="max-w-64" side="top" tooltipStyle>
        {reason}
      </PopoverPopup>
    </Popover>
  );
}

function ActivityProgress({ activity }: { activity: Activity }) {
  const percent = activity.bytes
    ? Math.min(100, Math.round((activity.doneBytes / activity.bytes) * 100))
    : 100;
  return (
    <span className="w-28 shrink-0 max-[37.5rem]:w-16">
      <span className="block h-1 overflow-hidden rounded-full bg-foreground/8">
        <span
          className="block h-full rounded-full bg-primary"
          style={{ width: `${percent}%` }}
        />
      </span>
      <span className="mt-1 block text-end text-label whitespace-nowrap text-muted-foreground">
        {activity.checking ? (
          <>
            <span className="max-[37.5rem]:hidden">Server is checking</span>
            <span className="min-[37.5rem]:hidden">Checking</span>
          </>
        ) : (
          <>
            {percent}%
            <span className="max-[37.5rem]:hidden">
              {" "}
              of {formatBytes(activity.bytes)}
            </span>
          </>
        )}
      </span>
    </span>
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
      detail: syncDetail(status),
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
  const waiting = Math.max(
    0,
    (state.status?.pendingFiles ?? 0) - running.length,
  );
  const moved = state.status?.movedBytes ?? 0;
  const total = moved + (state.status?.pendingBytes ?? 0);
  const { Icon, color, title, detail } = headline(state);
  const uploadSpeed = state.status?.uploadSpeed;
  const uploadEta =
    uploadSpeed == null
      ? ""
      : uploadTimeLeft(state.status?.uploadRemainingBytes ?? 0, uploadSpeed);
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
      <header className="flex items-center gap-3.5 px-5 pt-4.5 pb-4 max-sm:flex-wrap">
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
        <div className="flex shrink-0 items-center gap-2 max-sm:w-full max-sm:justify-end">
          {uploadSpeed != null ? (
            <span className="min-w-0 text-meta text-muted-foreground max-sm:mr-auto sm:text-end">
              {formatBytes(uploadSpeed)}/s{uploadEta ? ` · ${uploadEta}` : ""}
            </span>
          ) : null}
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
            style={{ width: `${(moved / total) * 100}%` }}
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
        {running.length + waiting > 0 ? (
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
              {waiting > 0 ? (
                <li className="flex items-center gap-3 px-5 py-2 text-meta text-muted-foreground">
                  <span className="grid size-8.5 shrink-0 place-items-center rounded-[0.625rem] bg-hover">
                    <Clock aria-hidden className="size-4.25" />
                  </span>
                  {waiting.toLocaleString()} more file
                  {waiting === 1 ? "" : "s"} waiting
                </li>
              ) : null}
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
                  paused={state.status?.state === "paused"}
                />
              ))}
            </ul>
          </section>
        ) : running.length + waiting === 0 ? (
          <p className="m-0 px-5 py-8 text-center text-body text-muted-foreground">
            Files you change show up here while they sync.
          </p>
        ) : null}
      </div>
    </>
  );
}
