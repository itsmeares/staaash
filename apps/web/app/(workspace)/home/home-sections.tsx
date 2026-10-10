"use client";

import Link from "next/link";
import { ArrowRight, Link2 } from "lucide-react";

import { DashboardItemContextMenu } from "@/app/dashboard-context-menu";
import { useTime } from "@/components/time-provider";
import {
  FileList,
  ItemIcon,
  ItemPreview,
  MiddleName,
  thumbnailUrlFor,
  type FileListItem,
} from "@/components/file-list/file-list";
import { buildItemActions } from "@/components/file-list/item-actions";
import { useListSelection } from "@/components/file-list/use-list-selection";
import { formatRelativeTime } from "@/lib/time";

import type { RecentClientItem } from "../recent/recent-helpers";
import { useCoarsePointer } from "../use-coarse-pointer";
import { useWorkspaceItemActions } from "../use-workspace-item-actions";
import { formatHomeExpiryTime } from "./home-helpers";

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
        <Link
          className="inline-flex items-center gap-1 rounded-sm text-meta text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          href={href}
        >
          {linkLabel}
          <ArrowRight aria-hidden className="size-3.5" />
        </Link>
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
    buildItemActions({
      name: item.name,
      kind: item.kind,
      open: () => actions.open(item),
      download: () => void actions.download([item]),
      favorite: {
        isFavorite: item.isFavorite,
        run: () =>
          void actions.setFavorite(item, { isFavorite: !item.isFavorite }),
      },
      trash: () => void actions.trash([item]),
    });

  const selection = useListSelection({
    ids: visibleRecent.map((item) => item.id),
    coarse,
    onOpen: (id) => {
      const item = recent.find((candidate) => candidate.id === id);
      if (item) actions.open(item);
    },
  });

  const recentItems: HomeListItem[] = visibleRecent.map((item) => ({
    id: item.id,
    kind: item.kind,
    name: item.name,
    mimeType: item.mimeType,
    sub: `${item.locationLabel} · ${formatRelativeTime(item.uploadedAt, now, timeZone)}`,
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
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {pickUp.map((item) => (
              <DashboardItemContextMenu groups={menuFor(item)} key={item.id}>
                <button
                  className="grid min-w-0 cursor-pointer overflow-hidden rounded-xl border border-border bg-card text-left outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring"
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
                        {formatRelativeTime(
                          item.uploadedAt,
                          now,
                          timeZone,
                          "long",
                        )}
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
          <div className="flex flex-wrap gap-2" id="home-pinned">
            {pinned.map((item) => (
              <DashboardItemContextMenu groups={menuFor(item)} key={item.id}>
                <button
                  className="flex h-10 max-w-64 min-w-0 cursor-pointer items-center gap-2.5 rounded-lg border border-border bg-card ps-3 pe-3.5 text-body outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring"
                  type="button"
                  onClick={() => actions.open(item)}
                >
                  <ItemIcon item={item} />
                  <MiddleName className="font-medium" name={item.name} />
                </button>
              </DashboardItemContextMenu>
            ))}
          </div>
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
                  <Link
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
                        expires in {formatHomeExpiryTime(share.expiresAt, now)}
                      </span>
                    </span>
                    <Link2
                      aria-hidden
                      className="size-4 text-muted-foreground"
                    />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
