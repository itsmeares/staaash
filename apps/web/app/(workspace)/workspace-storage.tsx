"use client";

import { SectionLabel } from "@/components/section-label";
import { cn } from "@/lib/utils";

type WorkspaceStorageProps = {
  usedBytes: string;
  limitBytes: string | null;
  diskUsedBytes: string | null;
  diskCapacityBytes: string | null;
  isAdmin: boolean;
};

function fmt(n: number): string {
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  if (n < 1024 * 1024 * 1024 * 1024)
    return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  return `${(n / (1024 * 1024 * 1024 * 1024)).toFixed(2)} TB`;
}

function barColor(pct: number): string {
  if (pct <= 65) return "bg-success";
  if (pct <= 85) return "bg-warning";
  return "bg-destructive";
}

export function WorkspaceStorage({
  usedBytes,
  limitBytes,
  diskUsedBytes,
  diskCapacityBytes,
  isAdmin,
}: WorkspaceStorageProps) {
  const used = Number(BigInt(usedBytes));
  const limit = limitBytes !== null ? Number(BigInt(limitBytes)) : null;
  const diskUsed =
    diskUsedBytes !== null ? Number(BigInt(diskUsedBytes)) : null;
  const diskCapacity =
    diskCapacityBytes !== null ? Number(BigInt(diskCapacityBytes)) : null;

  const showDiskView = isAdmin || limit === null;
  const num = showDiskView ? (diskUsed ?? used) : used;
  const denom = showDiskView ? diskCapacity : limit;

  const pct =
    denom !== null && denom > 0
      ? Math.min(100, Math.round((num / denom) * 100))
      : 0;

  const label =
    denom !== null ? `${fmt(num)} of ${fmt(denom)}` : `${fmt(num)} used`;

  return (
    <div className="flex flex-col gap-1.5 px-0.5">
      <SectionLabel>Storage</SectionLabel>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-foreground/15"
        role="meter"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Storage: ${label}`}
      >
        <div
          className={cn(
            "h-full min-w-0.5 transition-[width,background-color] duration-500 motion-reduce:transition-none",
            barColor(pct),
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="truncate text-xs text-muted-foreground lg:text-meta">
        {label}
      </span>
    </div>
  );
}
