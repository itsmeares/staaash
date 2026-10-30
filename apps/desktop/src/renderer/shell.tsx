import { Activity, Folder, Globe, Settings } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { cn } from "@staaash/ui/utils";

import { ActivityPage } from "./activity";
import { AppGlyph } from "./app-glyph";
import { FolderChooser } from "./folder-chooser";
import { CustomPauseDialog } from "./pause";
import { Connect, FoldersPage, SettingsPage, VersionProblem } from "./settings";
import { desktop, useAppState } from "./state";

export type Page = "activity" | "folders" | "settings";

function RailButton({
  label,
  current,
  badge,
  onClick,
  children,
}: {
  label: string;
  current?: boolean;
  badge?: number;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      aria-current={current ? "page" : undefined}
      aria-label={badge ? `${label}, ${badge} need you` : label}
      className={cn(
        "group relative grid size-10 cursor-pointer place-items-center rounded-xl border-0 bg-transparent text-muted-foreground hover:bg-hover focus-visible:bg-hover focus-visible:outline-none",
        current && "selected-pill text-foreground",
      )}
      type="button"
      onClick={onClick}
    >
      {children}
      {badge ? (
        <span
          aria-hidden
          className="absolute end-0.5 top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-warning px-1 text-[0.625rem] leading-none font-semibold text-primary-foreground ring-2 ring-background"
        >
          {badge}
        </span>
      ) : null}
      <span
        aria-hidden
        className="pointer-events-none absolute start-full top-1/2 z-20 ms-2 -translate-y-1/2 rounded-lg bg-popover px-2.5 py-1 text-label font-medium whitespace-nowrap text-foreground opacity-0 shadow-lg ring-1 ring-input transition-opacity group-hover:opacity-100 group-hover:delay-500 group-focus-visible:opacity-100"
      >
        {label}
      </span>
    </button>
  );
}

/** The one window: sign-in and setup first, then the rail and its pages. */
// Each first-run step and each page is a branch.
// fallow-ignore-next-line complexity
export function App() {
  const state = useAppState();
  const [page, setPage] = useState<Page>("activity");
  const [customPause, setCustomPause] = useState(false);

  // The tray can ask for a page or the pause box, even before this window opened.
  useEffect(() => {
    const take = () =>
      void desktop.takeCommand().then((command) => {
        if (command === "settings") setPage("settings");
        if (command === "custom-pause") {
          setPage("activity");
          setCustomPause(true);
        }
      });
    take();
    return desktop.onCommand(take);
  }, []);

  if (!state) return null;
  if (state.versionProblem) return <VersionProblem state={state} />;
  if (!state.signedIn) return <Connect state={state} />;
  if (state.settings.pairs.length === 0 && !state.settings.setupSkipped) {
    return (
      <main className="mx-auto w-full max-w-180 px-6 py-6">
        <FolderChooser
          existing={[]}
          submitLabel="Start syncing"
          onDone={() => {}}
          onSkip={() => void desktop.updateSettings({ setupSkipped: true })}
        />
      </main>
    );
  }
  const attention =
    (state.status?.conflicts.length ?? 0) + (state.status?.issues.length ?? 0);
  return (
    <div className="flex h-dvh bg-background py-2 pe-2 text-foreground">
      <nav
        aria-label="Staaash"
        className="relative z-10 flex w-14 shrink-0 flex-col items-center gap-1"
      >
        <AppGlyph className="mt-1 mb-3 w-7.5" />
        <RailButton
          badge={attention}
          current={page === "activity"}
          label="Activity"
          onClick={() => setPage("activity")}
        >
          <Activity aria-hidden className="size-4.5" />
        </RailButton>
        <RailButton
          current={page === "folders"}
          label="Folders"
          onClick={() => setPage("folders")}
        >
          <Folder aria-hidden className="size-4.5" />
        </RailButton>
        <RailButton
          current={page === "settings"}
          label="Settings"
          onClick={() => setPage("settings")}
        >
          <Settings aria-hidden className="size-4.5" />
        </RailButton>
        <div className="mt-auto">
          <RailButton
            label="Open drive"
            onClick={() => void desktop.openStaaash()}
          >
            <Globe aria-hidden className="size-4.5" />
          </RailButton>
        </div>
      </nav>
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl bg-card ring-1 ring-border">
        {page === "activity" ? (
          <ActivityPage
            state={state}
            onCustomPause={() => setCustomPause(true)}
            onNavigate={setPage}
          />
        ) : page === "folders" ? (
          <FoldersPage state={state} />
        ) : (
          <SettingsPage state={state} />
        )}
      </main>
      {customPause ? (
        <CustomPauseDialog onClose={() => setCustomPause(false)} />
      ) : null}
    </div>
  );
}
