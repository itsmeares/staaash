import { AppLink } from "@/components/app-link";
import { SettingsCard } from "@/components/settings-layout";
import { formatBytes } from "@/lib/format-bytes";
import { cn } from "@staaash/ui/utils";

// One bronze, lighter per person, so the biggest user reads first.
const SHADES = [100, 78, 60, 45, 32].map(
  (percent) => `color-mix(in oklab, var(--primary) ${percent}%, var(--card))`,
);
const OTHER = "color-mix(in oklab, var(--foreground) 30%, transparent)";
const FREE = "color-mix(in oklab, var(--foreground) 8%, transparent)";

type Part = { key: string; label: string; bytes: bigint; color: string };
type Disk = { capacityBytes: bigint; usedBytes: bigint };
type Person = { userId: string; name: string; bytes: bigint };

/** People largest first; past the shades, the rest share the last one. */
const peopleParts = (
  space: { userId: string; name: string; bytes: bigint }[],
) => {
  const named = space.length > SHADES.length ? SHADES.length - 1 : space.length;
  const parts: Part[] = space.slice(0, named).map((person, index) => ({
    key: person.userId,
    label: person.name,
    bytes: person.bytes,
    color: SHADES[index]!,
  }));
  const rest = space.slice(named);
  if (rest.length) {
    parts.push({
      key: "rest",
      label: `${rest.length} more people`,
      bytes: rest.reduce((sum, person) => sum + person.bytes, 0n),
      color: SHADES[SHADES.length - 1]!,
    });
  }
  return parts;
};

const diskParts = (people: Part[], staaash: bigint, disk: Disk): Part[] => [
  ...people,
  {
    key: "other",
    label: "Other things on the disk",
    bytes: disk.usedBytes > staaash ? disk.usedBytes - staaash : 0n,
    color: OTHER,
  },
  {
    key: "free",
    label: "Free",
    bytes: disk.capacityBytes - disk.usedBytes,
    color: FREE,
  },
];

const isPerson = (part: Part) => part.key !== "other" && part.key !== "free";

function Bar({ parts, whole }: { parts: Part[]; whole: bigint }) {
  const width = (bytes: bigint) =>
    whole > 0n ? Number((bytes * 10000n) / whole) / 100 : 0;
  return (
    <div className="flex h-3 gap-0.5 overflow-hidden rounded-full">
      {parts.map((part) => (
        <span
          key={part.key}
          style={{
            // A sliver keeps a small user visible next to a big disk.
            width: `max(${isPerson(part) && part.bytes > 0n ? "3px" : "0px"}, ${width(part.bytes)}%)`,
            background: part.color,
          }}
          title={`${part.label} ${formatBytes(part.bytes)}`}
        />
      ))}
    </div>
  );
}

function Legend({ parts }: { parts: Part[] }) {
  return (
    <>
      {parts.map((part) => (
        // The same row height as Health beside it, so both cards fill alike.
        <div
          className="flex min-h-11 items-center gap-2.5 border-t border-border px-3.5 py-2 text-meta"
          key={part.key}
        >
          <span
            aria-hidden
            className="size-2.5 shrink-0 rounded-xs"
            style={{ background: part.color }}
          />
          <span
            className={cn(
              "truncate",
              !isPerson(part) && "text-muted-foreground",
            )}
          >
            {part.label}
          </span>
          <span className="ms-auto text-muted-foreground tabular-nums">
            {formatBytes(part.bytes)}
          </span>
        </div>
      ))}
    </>
  );
}

/** The disk split into each person, other things on the disk, and free space. */
export function SpacePanel({
  space,
  disk,
}: {
  space: Person[];
  disk: Disk | null;
}) {
  const people = peopleParts(space);
  const staaash = people.reduce((sum, part) => sum + part.bytes, 0n);
  const parts = disk ? diskParts(people, staaash, disk) : people;
  const used = disk ? disk.usedBytes : staaash;
  return (
    <section className="grid grid-rows-[auto_1fr] gap-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="m-0 font-heading text-body font-semibold">Space</h2>
        <AppLink
          className="text-meta text-muted-foreground hover:text-foreground"
          href="/admin/users"
        >
          By person
        </AppLink>
      </div>
      <SettingsCard>
        <div className="grid gap-3 px-3.5 py-3">
          <span className="text-body">
            <b className="font-semibold tabular-nums">{formatBytes(used)}</b>{" "}
            <span className="text-muted-foreground">
              {disk
                ? `of ${formatBytes(disk.capacityBytes)} used`
                : "in Staaash"}
            </span>
          </span>
          <Bar parts={parts} whole={disk ? disk.capacityBytes : staaash} />
        </div>
        <Legend parts={parts} />
      </SettingsCard>
    </section>
  );
}
