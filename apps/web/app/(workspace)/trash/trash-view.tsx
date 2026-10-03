"use client";

import { RotateCcw, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

import { FlashMessage } from "@/app/auth-ui";
import { getItemVisual } from "@/app/item-visuals";
import { submitStorageMutationPost } from "@/app/storage-mutation-submit";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import {
  formatRecentFileSize,
  formatRecentRelativeTime,
} from "../recent/recent-helpers";
import { RecentGroupSections } from "../recent/recent-group-sections";
import {
  COLLECTION_ROW_LOCATION,
  COLLECTION_ROW_NAME,
  COLLECTION_ROW_SIZE,
  COLLECTION_ROW_TIME,
  CollectionColumnHead,
  CollectionEmpty,
  CollectionHeadLabel,
  CollectionRow,
  CollectionToolbar,
  DeletedBadge,
  InlineActions,
  RowActionButton,
  RowIcon,
  TypeFilterSelect,
} from "../collection-parts";
import { EmptyTrashAction } from "./trash-file-actions";
import {
  filterTrashItems,
  groupTrashItems,
  sortTrashItems,
  TRASH_FILTERS,
  TRASH_SORT_OPTIONS,
  type TrashClientItem,
  type TrashFilterType,
  type TrashSortOrder,
} from "./trash-helpers";
import { TrashContextMenu } from "./trash-context-menu";

type TrashViewProps = {
  error?: string | null;
  items: TrashClientItem[];
  success?: string | null;
};

const finishTrashMutation = (
  promise: Promise<void>,
  fallbackMessage: string,
) => {
  void promise
    .then(() => window.location.reload())
    .catch((error) =>
      window.alert(error instanceof Error ? error.message : fallbackMessage),
    );
};

function RestoreAction({ item }: { item: TrashClientItem }) {
  const kindPath = item.kind === "folder" ? "folders" : "files";

  return (
    <form
      action={`/api/files/${kindPath}/${item.id}/restore`}
      method="post"
      onSubmit={(event) => {
        event.preventDefault();
        finishTrashMutation(
          submitStorageMutationPost({
            action: event.currentTarget.action,
            fields: { redirectTo: "/trash" },
            logicalAction: `trash-restore:${item.kind}:${item.id}`,
          }),
          "Restore failed.",
        );
      }}
    >
      <input name="redirectTo" type="hidden" value="/trash" />
      <RowActionButton
        aria-label={`Restore ${item.name}`}
        title={`Restore ${item.name}`}
        type="submit"
      >
        <RotateCcw size={13} aria-hidden />
      </RowActionButton>
    </form>
  );
}

function DeleteFileAction({ item }: { item: TrashClientItem }) {
  if (item.kind !== "file") return null;

  return (
    <form
      action={`/api/files/files/${item.id}/delete`}
      method="post"
      onSubmit={(event) => {
        event.preventDefault();
        if (
          !window.confirm(
            `Permanently delete ${item.name}? This cannot be undone.`,
          )
        ) {
          return;
        }
        finishTrashMutation(
          submitStorageMutationPost({
            action: event.currentTarget.action,
            fields: { redirectTo: "/trash" },
            logicalAction: `trash-delete:file:${item.id}`,
          }),
          "Delete failed.",
        );
      }}
    >
      <input name="redirectTo" type="hidden" value="/trash" />
      <RowActionButton
        aria-label={`Delete ${item.name} permanently`}
        title={`Delete ${item.name} permanently`}
        tone="danger"
        type="submit"
      >
        <Trash2 size={13} aria-hidden />
      </RowActionButton>
    </form>
  );
}

function TrashRowActions({ item }: { item: TrashClientItem }) {
  if (item.storageMutationStatus) return null;
  return (
    <>
      <RestoreAction item={item} />
      <DeleteFileAction item={item} />
    </>
  );
}

function TrashEmptyState({ filtered }: { filtered: boolean }) {
  return (
    <CollectionEmpty
      description={
        filtered
          ? "Try a different type."
          : "Deleted files and folder roots show up here."
      }
      icon={<Trash2 aria-hidden />}
      title={filtered ? "No deleted items match that filter" : "Trash is empty"}
    />
  );
}

function TrashRow({ item }: { item: TrashClientItem }) {
  const deletedLabel = formatRecentRelativeTime(item.deletedAt);
  const sizeLabel =
    item.kind === "folder" ? "-" : formatRecentFileSize(item.sizeBytes);
  const visual = getItemVisual(
    item.kind,
    item.kind === "file" ? item.mimeType : null,
  );

  return (
    <TrashContextMenu
      disabled={Boolean(item.storageMutationStatus)}
      itemId={item.id}
      itemName={item.name}
      kind={item.kind}
    >
      <CollectionRow
        actionsColumn
        deleted
        id={`${item.kind}-${item.id}`}
        selected={false}
      >
        <RowIcon deleted visual={visual} />
        <span className={COLLECTION_ROW_NAME} title={item.name}>
          <span className="truncate">{item.name}</span>
          <DeletedBadge />
          {item.storageMutationStatus ? (
            <Badge size="sm" variant="neutral">
              {item.storageMutationStatus === "recovery_required"
                ? "Recovery required"
                : "Finishing storage operation"}
            </Badge>
          ) : null}
        </span>
        <span
          className={COLLECTION_ROW_LOCATION}
          title={`Restores to ${item.restoreTargetLabel}`}
        >
          {item.originalPathLabel}
        </span>
        <span className={COLLECTION_ROW_SIZE}>{sizeLabel}</span>
        <span
          className={cn(
            COLLECTION_ROW_TIME,
            "max-md:hidden pointer-coarse:hidden",
          )}
          title={item.deletedAt}
        >
          {deletedLabel}
        </span>
        <InlineActions className="justify-self-end">
          <TrashRowActions item={item} />
        </InlineActions>
      </CollectionRow>
    </TrashContextMenu>
  );
}

export function TrashView({ error, items, success }: TrashViewProps) {
  const [filterType, setFilterType] = useState<TrashFilterType>("all");
  const [sortOrder, setSortOrder] = useState<TrashSortOrder>("newest");

  const visibleItems = useMemo(
    () => sortTrashItems(filterTrashItems(items, filterType), sortOrder),
    [filterType, items, sortOrder],
  );
  const groups = useMemo(
    () => groupTrashItems(visibleItems, sortOrder),
    [sortOrder, visibleItems],
  );
  const filteredEmpty = items.length > 0 && visibleItems.length === 0;

  return (
    <>
      <PageHeader
        actions={<EmptyTrashAction disabled={items.length === 0} />}
        meta={items.length > 0 ? <Badge>{items.length}</Badge> : null}
        title="Deleted"
      />

      {error ? <FlashMessage>{error}</FlashMessage> : null}
      {success ? <FlashMessage tone="success">{success}</FlashMessage> : null}

      <CollectionToolbar aria-label="Deleted display controls">
        <TypeFilterSelect
          options={TRASH_FILTERS}
          value={filterType}
          onValueChange={(value) => setFilterType(value as TrashFilterType)}
        />
        <TypeFilterSelect
          label="Deleted"
          options={TRASH_SORT_OPTIONS}
          value={sortOrder}
          onValueChange={(value) => setSortOrder(value as TrashSortOrder)}
        />
      </CollectionToolbar>

      {visibleItems.length === 0 ? (
        <TrashEmptyState filtered={filteredEmpty} />
      ) : (
        <div className="relative grid min-h-0 pb-14 max-md:pb-22 pointer-coarse:pb-22">
          <CollectionColumnHead actionsColumn>
            <span aria-hidden />
            <CollectionHeadLabel>Name</CollectionHeadLabel>
            <CollectionHeadLabel>Location</CollectionHeadLabel>
            <CollectionHeadLabel align="right">Size</CollectionHeadLabel>
            <CollectionHeadLabel align="right">Deleted</CollectionHeadLabel>
            <CollectionHeadLabel align="right">Actions</CollectionHeadLabel>
          </CollectionColumnHead>

          <RecentGroupSections
            groups={groups}
            renderItem={(item) => (
              <TrashRow item={item} key={`${item.kind}-${item.id}`} />
            )}
          />
        </div>
      )}
    </>
  );
}
