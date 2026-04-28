"use client";

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
  const color = barColor(pct);

  const label =
    denom !== null ? `${fmt(num)} of ${fmt(denom)}` : `${fmt(num)} used`;

  return (
    <div className="workspace-storage">
      <span className="workspace-storage-label">Storage</span>
      <div
        className="workspace-storage-bar-track"
        role="meter"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Storage: ${label}`}
      >
        <div
          className="workspace-storage-bar-fill"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
      <span className="workspace-storage-text">{label}</span>
    </div>
  );
}
