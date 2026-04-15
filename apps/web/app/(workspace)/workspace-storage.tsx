"use client";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type WorkspaceStorageProps = {
  usedBytes: string;
  limitBytes: string | null;
  instanceUsedBytes: string;
};

function fmt(n: number): string {
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function barColor(pct: number): string {
  if (pct >= 90) return "oklch(42% 0.18 22)";
  if (pct >= 70) return "oklch(56% 0.14 42)";
  return "var(--primary)";
}

function ArcProgress({ pct, color }: { pct: number; color: string }) {
  const r = 14;
  const size = 36;
  const cx = size / 2;
  const cy = size / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - pct / 100);

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      style={{ flexShrink: 0 }}
      aria-hidden
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
  );
}

export function WorkspaceStorage({
  usedBytes,
  limitBytes,
  instanceUsedBytes,
}: WorkspaceStorageProps) {
  const used = Number(BigInt(usedBytes));
  const limit = limitBytes !== null ? Number(BigInt(limitBytes)) : null;
  const instanceUsed = Number(BigInt(instanceUsedBytes));
  const pct =
    limit !== null && limit > 0
      ? Math.min(100, Math.round((used / limit) * 100))
      : null;
  const color = pct !== null ? barColor(pct) : "var(--primary)";

  return (
    <TooltipProvider>
      <div className="workspace-storage">
        {/* Arc + quota text */}
        <div className="workspace-storage-main">
          <ArcProgress pct={pct ?? 0} color={color} />
          <div className="workspace-storage-text">
            <span className="workspace-storage-sizes">
              {fmt(used)}
              {limit !== null ? ` of ${fmt(limit)}` : ""}
            </span>
            <span className="workspace-storage-used-label">
              {pct !== null ? `Your quota · ${pct}% used` : "No quota set"}
            </span>
          </div>
        </div>

        {/* Server total — subtle hint with tooltip for context */}
        <Tooltip>
          <TooltipTrigger
            render={function (props) {
              return <div {...props} />;
            }}
            className="workspace-storage-drive-row"
          >
            <div
              className="workspace-storage-drive-track"
              role="meter"
              aria-valuenow={pct ?? 0}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Your storage quota"
            >
              <div
                className="workspace-storage-drive-fill"
                style={{
                  background: color,
                  width: `${pct ?? 0}%`,
                  opacity: 0.5,
                }}
              />
            </div>
            <span className="workspace-storage-drive-hint">
              Server: {fmt(instanceUsed)}
            </span>
          </TooltipTrigger>
          <TooltipContent side="right" sideOffset={8}>
            {fmt(instanceUsed)} used across all users on this instance.
            {limit !== null ? ` Your personal quota is ${fmt(limit)}.` : ""}
          </TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
}
