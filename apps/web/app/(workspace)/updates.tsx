"use client";

import { ArrowRight, ExternalLink, RotateCw, Zap } from "lucide-react";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { formatVersionLabel } from "@staaash/config/version";

import { DriveGlyph } from "@/components/drive-glyph";
import { Halftone } from "@/components/halftone";
import { useTime } from "@/components/time-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTab } from "@/components/ui/tabs";
import { toastManager } from "@/components/ui/toast";
import { subscribeLive } from "@/lib/live-events";
import { formatDateTime, formatRelativeTime } from "@/lib/time";
import { checkForUpdatesNow } from "@/lib/update-check-client";
import { getUpdateStatusLabel, type UpdateState } from "@/lib/update-status";

type UpdatesContext = {
  /** Null for members: update news is for owners. */
  state: UpdateState | null;
  appVersion: string;
  nodeVersion: string;
  /** The owner's "Tell me about new versions" preference. */
  notify: boolean;
  openAbout: () => void;
  openNotes: () => void;
};

const Context = createContext<UpdatesContext | null>(null);

export const useUpdates = () => {
  const value = useContext(Context);
  if (!value)
    throw new Error("useUpdates must be used inside <UpdatesProvider>.");
  return value;
};

const TOLD_KEY = "staaash:update-told:";

/** The first line of release notes that reads like a sentence. */
const leadLine = (notes: string) =>
  notes
    .split("\n")
    .map((line) =>
      line
        .replace(/^[#>*\-\s]+/, "")
        .replace(/[*_`]/g, "")
        .trim(),
    )
    .find((line) => line.length > 12) ?? null;

/**
 * Release notes are markdown. This draws headings, lists, links and
 * paragraphs as plain elements, which covers what release notes use.
 */
function ReleaseNotesText({ notes }: { notes: string }) {
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  const inline = (text: string) =>
    text.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/(\*\*|__|`)/g, "");
  const flush = () => {
    if (list.length === 0) return;
    blocks.push(
      <ul className="m-0 grid list-disc gap-1 ps-5" key={blocks.length}>
        {list.map((item, index) => (
          <li key={index}>{inline(item)}</li>
        ))}
      </ul>,
    );
    list = [];
  };
  for (const raw of notes.split("\n")) {
    const line = raw.trim();
    if (/^[-*] /.test(line)) {
      list.push(line.slice(2));
      continue;
    }
    flush();
    if (!line) continue;
    if (line.startsWith("#")) {
      blocks.push(
        <h3
          className="m-0 mt-2 font-sans text-body font-semibold"
          key={blocks.length}
        >
          {inline(line.replace(/^#+\s*/, ""))}
        </h3>,
      );
    } else {
      blocks.push(
        <p className="m-0" key={blocks.length}>
          {inline(line)}
        </p>,
      );
    }
  }
  flush();
  return blocks.length > 0 ? (
    <div className="grid gap-2 text-body text-foreground/90">{blocks}</div>
  ) : (
    <p className="m-0 text-body text-muted-foreground">
      No notes for this release.
    </p>
  );
}

function ReleaseNotesDialog({
  state,
  open,
  onOpenChange,
}: {
  state: UpdateState;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const releases =
    state.missed.length > 0 ? state.missed : state.latest ? [state.latest] : [];
  const [version, setVersion] = useState(releases[0]?.version);
  const release =
    releases.find((entry) => entry.version === version) ?? releases[0];
  const { timeZone } = useTime();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>What&apos;s new</DialogTitle>
          {state.missed.length > 1 ? (
            <DialogDescription>
              {state.missed.length} releases since{" "}
              {formatVersionLabel(state.currentVersion)}.
            </DialogDescription>
          ) : null}
        </DialogHeader>
        <DialogPanel className="grid gap-4">
          {releases.length > 1 ? (
            <Tabs
              value={release?.version}
              onValueChange={(next) => setVersion(String(next))}
            >
              <TabsList
                aria-label="Releases"
                className="max-w-full overflow-x-auto"
              >
                {releases.map((entry) => (
                  <TabsTab key={entry.version} value={entry.version}>
                    {formatVersionLabel(entry.version)}
                  </TabsTab>
                ))}
              </TabsList>
            </Tabs>
          ) : null}
          {release ? (
            <article className="grid gap-3">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <h2 className="m-0 font-heading text-lg font-semibold">
                  {release.name ?? formatVersionLabel(release.version)}
                </h2>
                {release.publishedAt ? (
                  <span className="text-meta text-muted-foreground">
                    {formatDateTime(release.publishedAt, timeZone)}
                  </span>
                ) : null}
              </div>
              <ReleaseNotesText notes={release.notes} />
            </article>
          ) : (
            <p className="m-0 text-body text-muted-foreground">
              No releases checked yet.
            </p>
          )}
        </DialogPanel>
        {release?.url ? (
          <DialogFooter>
            <Button
              render={<a href={release.url} rel="noreferrer" target="_blank" />}
              variant="outline"
            >
              <ExternalLink aria-hidden />
              Open on GitHub
            </Button>
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function AboutDialog({
  open,
  onOpenChange,
  onOpenNotes,
  onState,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenNotes: () => void;
  onState: (state: UpdateState) => void;
}) {
  const { state, appVersion, nodeVersion } = useUpdates();
  const { now, timeZone } = useTime();
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const checkNow = async () => {
    setChecking(true);
    setError(null);
    try {
      onState(await checkForUpdatesNow());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The check failed.");
    } finally {
      setChecking(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="flex-row items-center gap-3">
          <DriveGlyph className="w-9" />
          <div className="grid">
            <DialogTitle>Staaash</DialogTitle>
            <DialogDescription>
              {formatVersionLabel(appVersion)} · Node.js{" "}
              {nodeVersion.replace(/^v/, "")}
            </DialogDescription>
          </div>
        </DialogHeader>
        <DialogPanel className="grid gap-4">
          {state ? (
            state.status === "update-available" ? (
              <div className="grid gap-2 rounded-xl border border-primary/35 bg-primary/9 p-3.5">
                <p className="m-0 flex items-center gap-2 font-semibold">
                  <Zap aria-hidden className="size-4 text-primary-ink" />
                  {getUpdateStatusLabel(state)}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" onClick={onOpenNotes}>
                    What&apos;s new
                  </Button>
                  <span className="text-meta text-muted-foreground">
                    Pull the new image to update.
                  </span>
                </div>
              </div>
            ) : (
              <div className="grid gap-1 rounded-xl border border-border bg-hover p-3.5">
                <p className="m-0 font-semibold">
                  {getUpdateStatusLabel(state)}
                </p>
                {state.status === "up-to-date" ? (
                  <p className="m-0 text-meta text-muted-foreground">
                    {formatVersionLabel(appVersion)} is the latest release.
                  </p>
                ) : state.error ? (
                  <p className="m-0 text-meta text-muted-foreground">
                    {state.error}
                  </p>
                ) : null}
              </div>
            )
          ) : (
            <p className="m-0 text-meta text-muted-foreground">
              Your admin keeps Staaash up to date.
            </p>
          )}
          {state ? (
            <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-meta">
              <dt className="text-muted-foreground">Version</dt>
              <dd className="m-0 text-right">
                {formatVersionLabel(appVersion)}
              </dd>
              <dt className="text-muted-foreground">Channel</dt>
              <dd className="m-0 text-right">
                {state.channel === "rc" ? "Release candidates" : "Stable"}
              </dd>
              <dt className="text-muted-foreground">Last checked</dt>
              <dd className="m-0 text-right">
                {state.lastCheckedAt
                  ? formatRelativeTime(
                      state.lastCheckedAt,
                      now,
                      timeZone,
                      "long",
                    )
                  : "Not yet"}
              </dd>
            </dl>
          ) : null}
          {error ? (
            <p
              className="m-0 text-meta text-destructive-foreground"
              role="status"
            >
              {error}
            </p>
          ) : null}
        </DialogPanel>
        {state ? (
          <DialogFooter className="items-center sm:justify-between">
            <span className="text-meta text-muted-foreground">
              {state.enabled
                ? "Checks hourly and when Staaash starts"
                : "Checks are off"}
            </span>
            <Button
              disabled={checking || !state.enabled}
              loading={checking}
              size="sm"
              variant="outline"
              onClick={() => void checkNow()}
            >
              <RotateCw aria-hidden />
              Check now
            </Button>
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function Announcement({
  state,
  open,
  onOpenChange,
  onOpenNotes,
}: {
  state: UpdateState;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenNotes: () => void;
}) {
  const release = state.missed[0];
  if (!release) return null;
  const lead = leadLine(release.notes);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden sm:max-w-md">
        <div className="relative h-36 overflow-hidden">
          <Halftone
            still={
              typeof window !== "undefined" &&
              window.matchMedia("(prefers-reduced-motion: reduce)").matches
            }
          />
          <span className="absolute bottom-3 left-5 flex items-center gap-2 text-white">
            <DriveGlyph className="w-7" />
          </span>
        </div>
        <DialogHeader>
          <DialogTitle>
            {formatVersionLabel(release.version)} is out
          </DialogTitle>
          {lead ? <DialogDescription>{lead}</DialogDescription> : null}
        </DialogHeader>
        <DialogPanel>
          <div className="flex items-center gap-2 text-meta">
            <span className="text-muted-foreground">You&apos;re on</span>
            <Badge variant="neutral">
              {formatVersionLabel(state.currentVersion)}
            </Badge>
            <ArrowRight
              aria-hidden
              className="size-3.5 text-muted-foreground"
            />
            <Badge variant="accent">
              {formatVersionLabel(release.version)}
            </Badge>
          </div>
        </DialogPanel>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Later
          </Button>
          <Button
            onClick={() => {
              onOpenChange(false);
              onOpenNotes();
            }}
          >
            What&apos;s new
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Update news for owners: live state from the server, the About dialog, the
 * release notes viewer, and one notice per version: a toast for patch and
 * release-candidate releases, a short announcement for minor and major ones.
 */
export function UpdatesProvider({
  initialState,
  appVersion,
  nodeVersion,
  notify,
  children,
}: {
  initialState: UpdateState | null;
  appVersion: string;
  nodeVersion: string;
  notify: boolean;
  children: ReactNode;
}) {
  const [state, setState] = useState(initialState);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [announceOpen, setAnnounceOpen] = useState(false);
  const isOwner = initialState !== null;

  useEffect(() => {
    if (!isOwner) return;
    return subscribeLive("update", setState);
  }, [isOwner]);

  const newest =
    state?.status === "update-available" ? state.missed[0] : undefined;
  useEffect(() => {
    if (!notify || !newest || !state) return;
    const key = `${TOLD_KEY}${newest.version}`;
    if (window.localStorage.getItem(key)) return;
    window.localStorage.setItem(key, "1");
    if (state.kind === "major" || state.kind === "minor") {
      setAnnounceOpen(true);
      return;
    }
    toastManager.add({
      title: `${formatVersionLabel(newest.version)} is out`,
      description:
        state.kind === "prerelease"
          ? "A release candidate to try."
          : (leadLine(newest.notes) ?? "A small fix release."),
      type: "info",
      actionProps: {
        children: "What's new",
        onClick: () => setNotesOpen(true),
      },
    });
  }, [newest, notify, state]);

  return (
    <Context
      value={{
        state,
        appVersion,
        nodeVersion,
        notify,
        openAbout: () => setAboutOpen(true),
        openNotes: () => setNotesOpen(true),
      }}
    >
      {children}
      <AboutDialog
        open={aboutOpen}
        onOpenChange={setAboutOpen}
        onOpenNotes={() => {
          setAboutOpen(false);
          setNotesOpen(true);
        }}
        onState={setState}
      />
      {state ? (
        <>
          <ReleaseNotesDialog
            key={state.missed[0]?.version ?? state.latest?.version}
            onOpenChange={setNotesOpen}
            open={notesOpen}
            state={state}
          />
          <Announcement
            onOpenChange={setAnnounceOpen}
            onOpenNotes={() => setNotesOpen(true)}
            open={announceOpen}
            state={state}
          />
        </>
      ) : null}
    </Context>
  );
}
