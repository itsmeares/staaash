import { formatBytes } from "@/lib/format-bytes";

const PARTS = [
  { label: "Staaash", color: "var(--primary)" },
  {
    label: "Other things",
    color: "color-mix(in oklab, var(--foreground) 30%, transparent)",
  },
  {
    label: "Free",
    color: "color-mix(in oklab, var(--foreground) 8%, transparent)",
  },
];

/** The disk the files live on: what Staaash uses, what else does, what's left. */
export function DiskBar({
  capacityBytes,
  usedBytes,
  staaashBytes,
}: {
  capacityBytes: bigint;
  usedBytes: bigint;
  staaashBytes: bigint;
}) {
  const staaash = staaashBytes < usedBytes ? staaashBytes : usedBytes;
  const sizes = [staaash, usedBytes - staaash, capacityBytes - usedBytes];
  const width = (bytes: bigint) =>
    capacityBytes > 0n ? Number((bytes * 10000n) / capacityBytes) / 100 : 0;
  return (
    <div className="grid gap-2.5">
      <span className="text-body">
        <b className="font-semibold tabular-nums">{formatBytes(usedBytes)}</b>{" "}
        <span className="text-muted-foreground">
          of {formatBytes(capacityBytes)} used
        </span>
      </span>
      <div className="flex h-2.5 overflow-hidden rounded-full">
        {PARTS.map((part, index) => (
          <span
            key={part.label}
            style={{
              // A sliver stays visible so a small Staaash still shows up.
              width: `max(${index === 0 ? "3px" : "0px"}, ${width(sizes[index]!)}%)`,
              background: part.color,
            }}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-label text-muted-foreground">
        {PARTS.map((part, index) => (
          <span className="inline-flex items-center gap-1.5" key={part.label}>
            <span
              aria-hidden
              className="size-2 rounded-xs"
              style={{ background: part.color }}
            />
            {part.label} {formatBytes(sizes[index]!)}
          </span>
        ))}
      </div>
    </div>
  );
}
