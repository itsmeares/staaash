"use client";

import { ClipboardCopy, KeyRound, Link2, Share2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import { ShareDialog } from "@/app/(workspace)/files/share-dialog";
import type { DashboardContextMenuGroup } from "@/app/dashboard-context-menu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { toast } from "@/components/ui/toast";
import {
  FileList,
  type FileListColumn,
  type FileListItem,
} from "@/components/file-list/file-list";
import { TypeFilter } from "@/components/file-list/type-filter";
import { useListSelection } from "@/components/file-list/use-list-selection";
import { cn } from "@/lib/utils";
import type { ShareLinkSummary } from "@/server/sharing";

import { useCoarsePointer } from "../use-coarse-pointer";
import {
  filterWorkspaceItems,
  getWorkspaceLocationLabel,
  WORKSPACE_ITEM_FILTERS,
  type WorkspaceItemFilterType,
} from "../workspace-item-helpers";

export type SharedTableItem = {
  share: ShareLinkSummary;
  canManage: boolean;
  expiresLabel: string;
  expiryTone: "critical" | "default" | "warning";
  statusLabel: string;
};

type SharedListItem = FileListItem & { data: SharedTableItem };

const STATUS_VARIANT = {
  active: "success",
  expired: "neutral",
  revoked: "error",
  "target-unavailable": "neutral",
} as const;

const EXPIRY_TONE_CLASS = {
  critical: "font-semibold text-destructive-foreground",
  default: "",
  warning: "font-semibold text-warning-foreground",
} as const;

const accessLabel = (share: ShareLinkSummary) =>
  [
    share.hasPassword ? "Password" : "Anyone with the link",
    share.downloadDisabled ? "view only" : null,
  ]
    .filter(Boolean)
    .join(", ");

const copyLink = (share: ShareLinkSummary) => {
  void navigator.clipboard
    ?.writeText(share.shareUrl)
    .then(() => toast.success("Link copied."));
};

export function SharedTable({ items }: { items: SharedTableItem[] }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const isCoarsePointer = useCoarsePointer();
  const [filterType, setFilterType] = useState<WorkspaceItemFilterType>("all");
  const [manage, setManage] = useState<ShareLinkSummary | null>(null);

  const visibleItems = useMemo(
    () =>
      filterWorkspaceItems(
        items.map((item) => ({
          ...item,
          kind: item.share.target.targetType,
          mimeType:
            item.share.target.targetType === "file"
              ? item.share.target.mimeType
              : null,
        })),
        filterType,
      ),
    [filterType, items],
  );

  const listItems: SharedListItem[] = visibleItems.map((item) => ({
    id: item.share.id,
    kind: item.share.target.targetType,
    name: item.share.target.name,
    mimeType: item.mimeType,
    dimmed: item.share.status !== "active",
    flags: item.share.hasPassword ? (
      <KeyRound
        aria-label="Password protected"
        className="size-3.5 text-muted-foreground"
      />
    ) : null,
    sub: `${item.statusLabel} · ${item.expiresLabel}`,
    data: item,
  }));

  const open = ({ share }: SharedTableItem) => {
    if (share.target.targetType === "folder")
      router.push(`/files/f/${share.target.id}`);
    else router.push(`/files/view/${share.target.id}`);
  };

  const selection = useListSelection({
    ids: listItems.map((item) => item.id),
    coarse: isCoarsePointer,
    onOpen: (id) => {
      const item = items.find((candidate) => candidate.share.id === id);
      if (item && item.canManage) setManage(item.share);
    },
  });

  const getActions = ({
    data,
  }: SharedListItem): DashboardContextMenuGroup[] => [
    {
      actions: [
        {
          disabled: !data.canManage,
          icon: <Link2 className="size-4" />,
          label: "Manage link",
          onSelect: () => setManage(data.share),
        },
        {
          disabled: data.share.status !== "active",
          icon: <ClipboardCopy className="size-4" />,
          label: "Copy link",
          onSelect: () => copyLink(data.share),
        },
        {
          disabled: data.share.status === "target-unavailable",
          label:
            data.share.target.targetType === "folder"
              ? "Open folder"
              : "Open file",
          onSelect: () => open(data),
        },
      ],
    },
  ];

  const columns: FileListColumn<SharedListItem>[] = [
    {
      key: "location",
      label: "Location",
      width: "minmax(0,0.7fr)",
      priority: "wide",
      render: ({ data }) =>
        getWorkspaceLocationLabel({
          name: data.share.target.name,
          pathLabel: data.share.target.pathLabel,
        }),
    },
    {
      key: "status",
      label: "Status",
      width: "7.5rem",
      render: ({ data }) => (
        <Badge variant={STATUS_VARIANT[data.share.status]}>
          {data.statusLabel}
        </Badge>
      ),
    },
    {
      key: "expires",
      label: "Expires",
      width: "8rem",
      render: ({ data }) => (
        <span className={cn(EXPIRY_TONE_CLASS[data.expiryTone])}>
          {data.expiresLabel}
        </span>
      ),
    },
    {
      key: "access",
      label: "Access",
      width: "minmax(0,0.6fr)",
      priority: "wide",
      render: ({ data }) => accessLabel(data.share),
    },
  ];

  return (
    <>
      <TypeFilter
        options={WORKSPACE_ITEM_FILTERS}
        value={filterType}
        onValueChange={setFilterType}
      />

      <FileList
        coarse={isCoarsePointer}
        columns={columns}
        empty={
          <Empty className="min-h-64">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Share2 aria-hidden />
              </EmptyMedia>
              <EmptyTitle>No links of that type</EmptyTitle>
              <EmptyDescription>Try another type.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        }
        getActions={getActions}
        items={listItems}
        label="Shared links"
        quickActions={({ data }) =>
          data.canManage ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={(event) => {
                event.stopPropagation();
                setManage(data.share);
              }}
            >
              Manage
            </Button>
          ) : null
        }
        selection={selection}
      />

      {manage ? (
        <ShareDialog
          targetType={manage.target.targetType}
          targetId={manage.target.id}
          initialShare={manage}
          onClose={() => {
            setManage(null);
            startTransition(() => router.refresh());
          }}
        />
      ) : null}
    </>
  );
}
