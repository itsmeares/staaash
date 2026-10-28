import { AppLink } from "@/components/app-link";
import { ArrowRight, Link2 } from "lucide-react";

import { DashboardItemContextMenu } from "@/src/dashboard-context-menu";
import { useTime } from "@/components/time-provider";
import {
  FileList,
  ItemIcon,
  ItemPreview,
  thumbnailUrlFor,
  type FileListItem,
} from "@/components/file-list/file-list";
import { MiddleName } from "@/components/file-list/middle-name";
import { useItemSelection } from "@/components/file-list/use-list-selection";
import { formatRelativeTime, formatTimeUntil } from "@/lib/time";
import { cn } from "@staaash/ui/utils";

import type { RecentClientItem } from "../recent/recent-helpers";
import { useCoarsePointer } from "../use-coarse-pointer";
import { PinnedChips } from "../workspace-list-parts";
import {
  liveItemMenu,
  useWorkspaceItemActions,
} from "../use-workspace-item-actions";

export type HomeShare = {
  id: string;
  name: string;
  kind: "file" | "folder";
  mimeType?: string;
  downloadDisabled: boolean;
  hasPassword: boolean;
  expiresAt: string;
};

function SectionTitle({
  title,
  href,
  linkLabel,
}: {
  title: string;
  href?: string;
  linkLabel?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h2 className="m-0 font-sans text-body font-semibold">{title}</h2>
      {href ? (
        <AppLink
          className="inline-flex items-center gap-1 rounded-sm text-meta text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          href={href}
        >
          {linkLabel}
          <ArrowRight aria-hidden className="size-3.5" />
        </AppLink>
      ) : null}
    </div>
  );
}

type HomeListItem = FileListItem & { data: RecentClientItem };

/** Pick up where you left off, Pinned, then Recent beside Shared links. */
export function HomeSections({
  pickUp,
  pinned,
  recent,
  shares,
}: {
  pickUp: RecentClientItem[];
  pinned: RecentClientItem[];
  recent: RecentClientItem[];
  shares: HomeShare[];
}) {
  const { now, timeZone } = useTime();
  const coarse = useCoarsePointer();
  const actions = useWorkspaceItemActions("/home");
  const visibleRecent = recent.filter(
    (item) => !actions.trashedIds.has(item.id),
  );

  const menuFor = (item: RecentClientItem) =>
    liveItemMenu(actions, item, [item]);

  const { selection } = useItemSelection({
    items: visibleRecent,
    coarse,
    onOpen: actions.open,
  });

  const recentItems: HomeListItem[] = visibleRecent.map((item) => ({
    id: item.id,
    kind: item.kind,
    name: item.name,
    mimeType: item.mimeType,
    thumbnailUrl: thumbnailUrlFor(item),
    sub: `${item.locationLabel} · ${formatRelativeTime(item.at, now, timeZone)}`,
    data: item,
  }));

  return (
    <div className="grid gap-7">
      {pickUp.length > 0 ? (
        <section aria-labelledby="home-pick-up" className="grid gap-3">
          <h2
            className="m-0 font-sans text-body font-semibold"
            id="home-pick-up"
          >
            Pick up where you left off
          </h2>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 3xl:grid-cols-6">
            {pickUp.map((item, index) => (
              <DashboardItemContextMenu groups={menuFor(item)} key={item.id}>
                <button
                  className={cn(
                    "grid min-w-0 cursor-pointer overflow-hidden rounded-xl border border-border bg-card text-left outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring",
                    // The fifth and sixth only fill the wide row.
                    index >= 4 && "hidden 3xl:grid",
                  )}
                  type="button"
                  onClick={() => actions.open(item)}
                >
                  <ItemPreview
                    className="aspect-video rounded-none"
                    item={{ ...item, thumbnailUrl: thumbnailUrlFor(item) }}
                  />
                  <span className="flex min-w-0 items-start gap-2 px-3 py-2.5">
                    <ItemIcon
                      className="mt-0.5 size-4 [&_svg]:size-4"
                      item={item}
                    />
                    <span className="grid min-w-0">
                      <MiddleName
                        className="text-body font-medium"
                        name={item.name}
                      />
                      <span className="truncate text-label text-muted-foreground">
                        {formatRelativeTime(item.at, now, timeZone, "long")}
                      </span>
                    </span>
                  </span>
                </button>
              </DashboardItemContextMenu>
            ))}
          </div>
        </section>
      ) : null}

      {pinned.length > 0 ? (
        <section aria-labelledby="home-pinned" className="grid gap-3">
          <SectionTitle
            href="/favorites"
            linkLabel="Favorites"
            title="Pinned"
          />
          <PinnedChips
            id="home-pinned"
            items={pinned}
            menuFor={menuFor}
            onOpen={actions.open}
          />
        </section>
      ) : null}

      <div className="grid items-start gap-7 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <section aria-labelledby="home-recent" className="grid min-w-0 gap-2">
          <SectionTitle href="/recent" linkLabel="All recent" title="Recent" />
          <FileList
            coarse={coarse}
            columns={[]}
            empty={
              <p className="m-0 py-6 text-meta text-muted-foreground">
                Nothing yet. Files you add or open show up here.
              </p>
            }
            getActions={({ data }) => menuFor(data)}
            items={recentItems}
            label="Recent"
            selection={selection}
          />
        </section>

        <section aria-labelledby="home-shared" className="grid min-w-0 gap-2">
          <SectionTitle
            href="/shared"
            linkLabel="Manage"
            title="Shared links"
          />
          {shares.length === 0 ? (
            <p className="m-0 py-6 text-meta text-muted-foreground">
              No active links. Choose Share on any file or folder.
            </p>
          ) : (
            <ul className="m-0 grid list-none gap-px p-0">
              {shares.map((share) => (
                <li key={share.id}>
                  <AppLink
                    className="grid min-h-12 grid-cols-[1.25rem_minmax(0,1fr)_auto] items-center gap-2.5 rounded-lg px-2 py-1.5 outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring"
                    href={`/shared#${share.id}`}
                  >
                    <ItemIcon item={share} />
                    <span className="grid min-w-0">
                      <MiddleName
                        className="text-body font-medium"
                        name={share.name}
                      />
                      <span className="truncate text-label text-muted-foreground">
                        {share.hasPassword ? "Password, " : ""}
                        {share.downloadDisabled ? "view only, " : ""}
                        expires in {formatTimeUntil(share.expiresAt, now)}
                      </span>
                    </span>
                    <Link2
                      aria-hidden
                      className="size-4 text-muted-foreground"
                    />
                  </AppLink>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
