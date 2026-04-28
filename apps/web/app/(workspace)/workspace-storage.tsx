"use client";

import { useState } from "react";

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
  if (pct >= 90) return "oklch(42% 0.18 22)";
  if (pct >= 70) return "oklch(56% 0.14 42)";
  return "var(--primary)";
}

function ArcProgress({
  pct,
  color,
  hovered,
  displayValue,
}: {
  pct: number;
  color: string;
  hovered: boolean;
  displayValue: string;
}) {
  const size = 56;
  const r = 23;
  const cx = size / 2;
  const cy = size / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - pct / 100);

  return (
    <div className="workspace-storage-arc-wrap" aria-hidden>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        style={{ display: "block" }}
      >
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke="color-mix(in oklab, var(--foreground) 10%, transparent)"
          strokeWidth="3.5"
        />
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${cx} ${cy})`}
          style={{
            transition: "stroke-dashoffset 500ms ease, stroke 600ms ease",
          }}
        />
      </svg>
      <div className="workspace-storage-arc-inner">
        <span
          className="workspace-storage-arc-pct"
          style={{
            opacity: hovered ? 0 : 1,
            transform: hovered ? "scale(0.7)" : "scale(1)",
          }}
        >
          {pct}%
        </span>
        <span
          className="workspace-storage-arc-val"
          style={{
            opacity: hovered ? 1 : 0,
            transform: hovered ? "scale(1)" : "scale(0.7)",
          }}
        >
          {displayValue}
        </span>
      </div>
    </div>
  );
}

export function WorkspaceStorage({
  usedBytes,
  limitBytes,
  diskUsedBytes,
  diskCapacityBytes,
  isAdmin,
}: WorkspaceStorageProps) {
  const [hovered, setHovered] = useState(false);

  const used = Number(BigInt(usedBytes));
  const limit = limitBytes !== null ? Number(BigInt(limitBytes)) : null;
  const diskUsed =
    diskUsedBytes !== null ? Number(BigInt(diskUsedBytes)) : null;
  const diskCapacity =
    diskCapacityBytes !== null ? Number(BigInt(diskCapacityBytes)) : null;

  // Admin and quota-less users see real disk usage vs total disk capacity
  const showDiskView = isAdmin || limit === null;
  const num = showDiskView ? (diskUsed ?? used) : used;
  const denom = showDiskView ? diskCapacity : limit;

  const pct =
    denom !== null && denom > 0
      ? Math.min(100, Math.round((num / denom) * 100))
      : 0;
  const color = barColor(pct);

  const label = denom !== null ? `of ${fmt(denom)} used` : `${fmt(num)} used`;

  return (
    <div
      className="workspace-storage"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="workspace-storage-main">
        <ArcProgress
          pct={pct}
          color={color}
          hovered={hovered}
          displayValue={fmt(num)}
        />
        <span className="workspace-storage-line">{label}</span>
      </div>
    </div>
  );
}
