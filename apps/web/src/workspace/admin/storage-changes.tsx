import { ChevronLeft } from "lucide-react";
import { MutationRow } from "./storage-mutation-row";
import { AppLink } from "@/components/app-link";

import { PageHeader } from "@/components/page-header";
import { SettingsCard } from "@/components/settings-layout";
import { Button } from "@staaash/ui/components/button";
import { useSuspenseQuery } from "@tanstack/react-query";

import { useRefresh } from "@/lib/use-refresh";
import { AdminGroup, AdminPage } from "./admin-panel";
import { adminStorageQuery } from "@/src/queries";

import { summaryOf } from "./storage-change";

const plural = (count: number, word: string) =>
  `${count} ${word}${count === 1 ? "" : "s"}`;

const words = (value: string) =>
  value.charAt(0).toUpperCase() + value.slice(1).replaceAll("_", " ");

const shortDate = (value: string) =>
  new Date(value).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

const outcomes = {
  finish: "Finished",
  keep: "Kept as it is now",
  undo: "Undone",
  remove: "Removed",
  retry: "Checked again",
} as const;

const rowClass =
  "flex min-h-15 items-center gap-3 border-t border-border px-4 py-2.5 first:border-t-0";

type StorageData = Awaited<
  ReturnType<ReturnType<typeof adminStorageQuery>["queryFn"] & {}>
>;
type NameOf = Map<string, string>;

const changeLink = (id: string) => `/admin/maintenance/changes/${id}`;

function ReviewGroup({
  review,
  nameOf,
  isOwner,
}: {
  review: StorageData["mutations"];
  nameOf: NameOf;
  isOwner: boolean;
}) {
  if (!review.length) return null;
  return (
    <AdminGroup title="Needs review">
      <SettingsCard>
        {review.map((mutation) => (
          <div className={rowClass} key={mutation.id}>
            <span className="grid min-w-0 flex-1">
              <span className="truncate text-body font-medium">
                {words(mutation.kind)} ·{" "}
                {nameOf.get(mutation.ownerUserId) ?? mutation.ownerUserId}
              </span>
              <span className="truncate text-label text-muted-foreground">
                {mutation.review
                  ? summaryOf(
                      mutation.review,
                      mutation.review.itemName ?? "This item",
                    )
                  : "Not checked yet. Open it to check the disk."}
              </span>
            </span>
            <Button
              render={<AppLink href={changeLink(mutation.id)} />}
              size="sm"
              variant={isOwner ? "default" : "outline"}
            >
              {isOwner ? "Review" : "Details"}
            </Button>
          </div>
        ))}
      </SettingsCard>
    </AdminGroup>
  );
}

const fixedBy = (item: StorageData["fixed"][number], nameOf: NameOf) =>
  item.automatic
    ? "Automatically"
    : (nameOf.get(item.byUserId ?? "") ?? "Owner");

function FixedGroup({
  fixed,
  nameOf,
}: {
  fixed: StorageData["fixed"];
  nameOf: NameOf;
}) {
  if (!fixed.length) return null;
  return (
    <AdminGroup title="Fixed">
      <SettingsCard>
        {fixed.map((item) => (
          <AppLink
            className={`${rowClass} outline-none hover:bg-hover focus-visible:bg-hover`}
            href={changeLink(item.id)}
            key={item.id}
          >
            <span className="grid min-w-0 flex-1">
              <span className="truncate text-body font-medium">
                {words(item.kind)} ·{" "}
                {nameOf.get(item.ownerUserId) ?? item.ownerUserId}
              </span>
              <span className="truncate text-label text-muted-foreground">
                {item.choice ? outcomes[item.choice] : "Fixed"} ·{" "}
                {fixedBy(item, nameOf)}
                {item.keptCount
                  ? ` · ${plural(item.keptCount, "copy")} kept`
                  : ""}
              </span>
            </span>
            <span className="text-label text-muted-foreground tabular-nums">
              {shortDate(item.reviewedAt)}
            </span>
          </AppLink>
        ))}
      </SettingsCard>
    </AdminGroup>
  );
}

function UnfinishedGroup({
  mutations,
  mutationId,
  nameOf,
  isOwner,
}: {
  mutations: StorageData["mutations"];
  mutationId?: string;
  nameOf: NameOf;
  isOwner: boolean;
}) {
  return (
    <AdminGroup title={mutationId ? "Selected change" : "Unfinished changes"}>
      <SettingsCard>
        {mutations.length === 0 ? (
          <p className="m-0 px-4 py-3.5 text-body text-muted-foreground">
            {mutationId
              ? "This change is no longer unfinished, or could not be found. Refresh Files to check whether the item is available."
              : "Nothing unfinished"}
          </p>
        ) : (
          mutations.map((mutation) => (
            <MutationRow
              key={mutation.id}
              mutation={mutation}
              isOwner={isOwner}
              owner={nameOf.get(mutation.ownerUserId) ?? mutation.ownerUserId}
            />
          ))
        )}
      </SettingsCard>
    </AdminGroup>
  );
}

export function StorageChangesPage({ mutationId }: { mutationId?: string }) {
  const data = useSuspenseQuery(adminStorageQuery(mutationId)).data;
  const { summary, fixed } = data;
  const review = data.mutations.filter(
    (mutation) => mutation.status === "recovery_required",
  );
  const mutations = data.mutations.filter(
    (mutation) => mutation.status !== "recovery_required",
  );
  const refresh = useRefresh();
  const nameOf: NameOf = new Map(
    summary.rows.map((row) => [row.userId, row.displayName ?? row.email]),
  );

  const changes = (
    <UnfinishedGroup
      isOwner={data.isOwner}
      mutationId={mutationId}
      mutations={mutations}
      nameOf={nameOf}
    />
  );

  return (
    <AdminPage>
      <Button
        className="-ms-2 justify-self-start"
        render={<AppLink href="/admin/maintenance" />}
        size="sm"
        variant="ghost-muted"
      >
        <ChevronLeft aria-hidden />
        Maintenance
      </Button>
      <PageHeader
        title="Storage changes"
        actions={
          <div className="flex flex-wrap gap-2">
            {mutationId ? (
              <Button
                variant="link"
                size="sm"
                render={<AppLink href="/admin/maintenance/changes" />}
              >
                Show all unfinished changes
              </Button>
            ) : null}
            <Button variant="outline" size="sm" onClick={() => void refresh()}>
              Refresh
            </Button>
          </div>
        }
      />
      <ReviewGroup isOwner={data.isOwner} nameOf={nameOf} review={review} />
      {mutationId && !review.length ? changes : null}
      {/* An empty list only says something when nothing else is shown. */}
      {mutationId ||
      (mutations.length === 0 && review.length + fixed.length > 0)
        ? null
        : changes}

      <FixedGroup fixed={fixed} nameOf={nameOf} />
    </AdminPage>
  );
}
