"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { KeyRound, Share2 } from "lucide-react";
import { useMemo, useState, useTransition } from "react";

import { ShareDialog } from "@/app/(workspace)/files/share-dialog";
import {
  DashboardItemContextMenu,
  type DashboardContextMenuGroup,
} from "@/app/dashboard-context-menu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { ShareLinkSummary } from "@/server/sharing";

import {
  CollectionEmpty,
  CollectionToolbar,
  TypeFilterSelect,
} from "../collection-parts";

export type SharedTableItem = {
  share: ShareLinkSummary;
  canManage: boolean;
  expiresLabel: string;
  expiryTone: "critical" | "default" | "warning";
  statusLabel: string;
};

type SharedTableProps = {
  items: SharedTableItem[];
};

type SharedFilterType =
  "all" | "archive" | "audio" | "folder" | "image" | "pdf" | "text" | "video";

const FILTERS: { id: SharedFilterType; label: string }[] = [
  { id: "all", label: "All" },
  { id: "folder", label: "Folders" },
  { id: "image", label: "Images" },
  { id: "pdf", label: "PDFs" },
  { id: "video", label: "Videos" },
  { id: "audio", label: "Audio" },
  { id: "text", label: "Docs" },
  { id: "archive", label: "Archives" },
];

const STATUS_VARIANT = {
  active: "accent",
  expired: "neutral",
  revoked: "error",
  "target-unavailable": "neutral",
} as const;

const EXPIRY_TONE_CLASS = {
  critical: "font-semibold text-destructive-foreground",
  default: "",
  warning: "font-semibold text-warning-foreground",
} as const;

function StatusBadge({
  status,
  label,
}: {
  status: ShareLinkSummary["status"];
  label: string;
}) {
  return (
    <Badge className="shrink-0" variant={STATUS_VARIANT[status]}>
      {label}
    </Badge>
  );
}

function PasswordHint() {
  return (
    <KeyRound
      aria-label="Password protected"
      className="text-primary-ink"
      size={13}
    />
  );
}

function getShareType(share: ShareLinkSummary): SharedFilterType {
  if (share.target.targetType === "folder") return "folder";

  const mime = share.target.mimeType ?? "";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.includes("pdf")) return "pdf";
  if (
    mime.startsWith("text/") ||
    mime.includes("typescript") ||
    mime.includes("json") ||
    mime.includes("document")
  ) {
    return "text";
  }
  if (
    mime.includes("zip") ||
    mime.includes("archive") ||
    mime.includes("tar") ||
    mime.includes("gzip")
  ) {
    return "archive";
  }

  return "all";
}

function getShareTypeLabel(share: ShareLinkSummary): string {
  const type = getShareType(share);
  if (type === "all")
    return share.target.targetType === "file" ? "File" : "Folder";
  if (type === "pdf") return "PDF";
  return type.charAt(0).toUpperCase() + type.slice(1);
}

function splitPathLabel(pathLabel: string): string[] {
  return pathLabel
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);
}

function getShareLocationLabel(share: ShareLinkSummary): string {
  const parts = splitPathLabel(share.target.pathLabel);
  const pathWithoutSelf =
    parts.at(-1) === share.target.name ? parts.slice(0, -1) : parts;
  const withoutRoot =
    pathWithoutSelf.length > 1 ? pathWithoutSelf.slice(1) : [];
  return withoutRoot.length > 0 ? `/ ${withoutRoot.join(" / ")} /` : "/";
}

export function SharedTable({ items }: SharedTableProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [filterType, setFilterType] = useState<SharedFilterType>("all");
  const [shareDialogTarget, setShareDialogTarget] = useState<{
    targetType: "file" | "folder";
    targetId: string;
    share: ShareLinkSummary;
  } | null>(null);
  const visibleItems = useMemo(() => {
    if (filterType === "all") return items;
    return items.filter(({ share }) => getShareType(share) === filterType);
  }, [filterType, items]);
  const getShareItemContextGroups = ({
    canManage,
    share,
  }: SharedTableItem): DashboardContextMenuGroup[] => [
    {
      actions: [
        {
          disabled: !canManage,
          label: "Manage link",
          onSelect: () =>
            setShareDialogTarget({
              targetType: share.target.targetType,
              targetId: share.target.id,
              share,
            }),
        },
      ],
    },
    {
      actions: [
        {
          label: "Copy name",
          onSelect: () => {
            void navigator.clipboard?.writeText(share.target.name);
          },
        },
      ],
    },
  ];

  const openManage = (share: ShareLinkSummary) =>
    setShareDialogTarget({
      targetType: share.target.targetType,
      targetId: share.target.id,
      share,
    });

  return (
    <>
      <CollectionToolbar
        aria-label="Shared display controls"
        className="justify-between"
      >
        <TypeFilterSelect
          options={FILTERS}
          value={filterType}
          onValueChange={(value) => setFilterType(value as SharedFilterType)}
        />
        <Button
          render={<Link href="/files" />}
          size="sm"
          className="max-md:flex-1"
        >
          + New share link
        </Button>
      </CollectionToolbar>

      {visibleItems.length === 0 ? (
        <CollectionEmpty
          description="Try a different type."
          icon={<Share2 aria-hidden />}
          title="No shared links match that filter"
        />
      ) : (
        <>
          <div className="hidden gap-2.5 max-xs:grid">
            {visibleItems.map((item) => {
              const {
                share,
                canManage,
                expiresLabel,
                expiryTone,
                statusLabel,
              } = item;
              const locationLabel = getShareLocationLabel(share);
              return (
                <DashboardItemContextMenu
                  groups={getShareItemContextGroups(item)}
                  key={share.id}
                >
                  <article
                    className={cn(
                      "grid gap-3 rounded-lg border bg-hover p-3",
                      share.status !== "active" && "opacity-60",
                    )}
                    id={`mobile-${share.id}`}
                  >
                    <div className="flex items-center justify-between gap-2.5">
                      <span
                        className="min-w-0 truncate text-label font-semibold"
                        title={share.target.name}
                      >
                        {share.target.name}
                      </span>
                      <StatusBadge status={share.status} label={statusLabel} />
                    </div>
                    <dl className="m-0 grid gap-2 text-label">
                      {[
                        ["Location", locationLabel, ""],
                        ["Type", getShareTypeLabel(share), ""],
                        [
                          "Expires",
                          expiresLabel,
                          cn("tabular-nums", EXPIRY_TONE_CLASS[expiryTone]),
                        ],
                      ].map(([term, value, valueClass]) => (
                        <div className="grid gap-0.5" key={term}>
                          <dt className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                            {term}
                          </dt>
                          <dd className={cn("m-0 truncate", valueClass)}>
                            {value}
                          </dd>
                        </div>
                      ))}
                    </dl>
                    <div className="flex items-center gap-2">
                      <Button
                        disabled={!canManage}
                        size="sm"
                        variant="secondary"
                        onClick={() => openManage(share)}
                      >
                        Manage
                      </Button>
                      {share.hasPassword ? <PasswordHint /> : null}
                    </div>
                  </article>
                </DashboardItemContextMenu>
              );
            })}
          </div>

          <div className="overflow-hidden rounded-lg border max-xs:hidden">
            <Table className="min-w-190 table-fixed">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[29%]" scope="col">
                    Name
                  </TableHead>
                  <TableHead className="w-[25%]" scope="col">
                    Location
                  </TableHead>
                  <TableHead className="w-[11%]" scope="col">
                    Type
                  </TableHead>
                  <TableHead className="w-[15%]" scope="col">
                    Expires
                  </TableHead>
                  <TableHead className="w-[11%]" scope="col">
                    Status
                  </TableHead>
                  <TableHead className="w-[9%]" scope="col">
                    Actions
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleItems.map((item) => {
                  const {
                    share,
                    canManage,
                    expiresLabel,
                    expiryTone,
                    statusLabel,
                  } = item;
                  const locationLabel = getShareLocationLabel(share);

                  return (
                    <DashboardItemContextMenu
                      groups={getShareItemContextGroups(item)}
                      key={share.id}
                    >
                      <TableRow
                        className={cn(
                          share.status !== "active" && "opacity-60",
                        )}
                        id={share.id}
                      >
                        <TableCell className="truncate px-3.5 text-label font-semibold">
                          <span title={share.target.name}>
                            {share.target.name}
                          </span>
                        </TableCell>
                        <TableCell className="truncate px-3.5 text-label text-muted-foreground">
                          <span title={locationLabel}>{locationLabel}</span>
                        </TableCell>
                        <TableCell className="truncate px-3.5 text-label text-muted-foreground">
                          {getShareTypeLabel(share)}
                        </TableCell>
                        <TableCell
                          className={cn(
                            "truncate px-3.5 text-label tabular-nums",
                            EXPIRY_TONE_CLASS[expiryTone],
                          )}
                        >
                          {expiresLabel}
                        </TableCell>
                        <TableCell className="px-3.5">
                          <StatusBadge
                            status={share.status}
                            label={statusLabel}
                          />
                        </TableCell>
                        <TableCell className="px-3.5">
                          <div className="flex items-center gap-2">
                            <Button
                              disabled={!canManage}
                              size="xs"
                              variant="ghost"
                              onClick={() => openManage(share)}
                            >
                              Manage
                            </Button>
                            {share.hasPassword ? (
                              <span title="Password protected">
                                <PasswordHint />
                              </span>
                            ) : null}
                          </div>
                        </TableCell>
                      </TableRow>
                    </DashboardItemContextMenu>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </>
      )}

      {shareDialogTarget ? (
        <ShareDialog
          targetType={shareDialogTarget.targetType}
          targetId={shareDialogTarget.targetId}
          initialShare={shareDialogTarget.share}
          onClose={() => {
            setShareDialogTarget(null);
            startTransition(() => router.refresh());
          }}
        />
      ) : null}
    </>
  );
}
