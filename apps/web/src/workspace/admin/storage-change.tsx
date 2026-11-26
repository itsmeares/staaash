import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { useState, type ReactNode } from "react";

import { AppLink } from "@/components/app-link";
import { confirmAction } from "@/components/confirm-dialog";
import { PageHeader } from "@/components/page-header";
import { SettingsCard, SettingsRow } from "@/components/settings-layout";
import { api, read } from "@/lib/api";
import { formatBytes } from "@/lib/format-bytes";
import { adminStorageChangeQuery } from "@/src/queries";
import { Badge } from "@staaash/ui/components/badge";
import { Button } from "@staaash/ui/components/button";
import { Spinner } from "@staaash/ui/components/spinner";
import { toastManager } from "@staaash/ui/components/toast";

import { UserDetailCopyButton } from "./user-detail-copy-button";

type Change = Awaited<
  ReturnType<ReturnType<typeof adminStorageChangeQuery>["queryFn"] & {}>
>;
type Inspection = NonNullable<Change["inspection"]>;
type Place = Inspection["places"][number];
type ChoiceId = Inspection["choices"][number]["id"];

const words = (value: string) =>
  value.charAt(0).toUpperCase() + value.slice(1).replaceAll("_", " ");

const shortDate = (value: string | null) =>
  value
    ? new Date(value).toLocaleString(undefined, {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";

const plural = (count: number, word: string) =>
  `${count} ${word}${count === 1 ? "" : "s"}`;

const sizeOf = (place: Place) =>
  place.sizeBytes === null
    ? null
    : place.isFolder
      ? `${plural(place.fileCount ?? 0, "file")}, ${formatBytes(place.sizeBytes)}`
      : formatBytes(place.sizeBytes);

const placeRoles = { new: "New place", old: "Old place", leftover: "Leftover" };

const stateBadges = {
  matches: { variant: "success", label: "Matches" },
  empty: { variant: "neutral", label: "Empty" },
  missing: { variant: "error", label: "Missing" },
  unsafe: { variant: "error", label: "Unsafe" },
} as const;

function PlaceBadge({ place }: { place: Place }) {
  if (place.state !== "changed") {
    const badge = stateBadges[place.state];
    return <Badge variant={badge.variant}>{badge.label}</Badge>;
  }
  const shrankOrGrew =
    !place.isFolder &&
    place.expectedSizeBytes !== null &&
    place.expectedSizeBytes !== place.sizeBytes;
  return (
    <Badge variant="warning">
      {shrankOrGrew
        ? `Was ${formatBytes(place.expectedSizeBytes!)}`
        : "Changed"}
    </Badge>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-2.5">
      <h2 className="m-0 font-heading text-body font-semibold">{title}</h2>
      {children}
    </section>
  );
}

const summaries: Record<Inspection["group"], (item: string) => string> = {
  two_copies: (item) =>
    `${item} is in both places, and neither copy matches what Staaash saved.`,
  no_copy: (item) => `Staaash cannot find ${item} in either place.`,
  changed: (item) => `${item} changed after Staaash saved it.`,
  in_the_way: () =>
    "Something is in the way of this change. Staaash keeps it as a copy and finishes.",
  unsafe: (item) =>
    `${item} has something Staaash never touches: a shortcut, a special file, or a path that leaves the storage folder.`,
  waiting: () => "This change waits for another stopped change.",
  clear: () => "Nothing on the disk stops this change now.",
  broken: () =>
    "The saved plan for this change does not work. This is a Staaash bug.",
};

export const summaryOf = (
  inspection: { group: Inspection["group"]; error?: string | null },
  item: string,
) =>
  inspection.error
    ? `Staaash could not check the disk: ${inspection.error}`
    : summaries[inspection.group](item);

const serverStepOf = (inspection: Inspection, place: string) => {
  switch (inspection.unsafeReason) {
    case "shortcut_or_special_file":
    case "shortcut_inside":
      return `Remove the shortcut (symlink) at or inside ${place} on the server. It holds no data.`;
    case "special_file_inside":
      return `Remove the special file (socket or pipe) inside ${place} on the server.`;
    case "unsafe_path":
      return `A folder on the way to ${place} is a shortcut or leaves the storage folder. Fix that path on the server.`;
    default:
      return `Staaash cannot read ${place}. Check its permissions on the server.`;
  }
};

type ChoiceRow = {
  id: ChoiceId;
  label: string;
  hint?: string;
  destructive?: boolean;
};

type RowContext = {
  inspection: Inspection;
  item: string;
  owner: string;
  kind: string;
  copy: string | null;
  size: string | null;
  atOldPlace: boolean;
};

type RowText = Omit<ChoiceRow, "id">;

const finishRow = ({ inspection, item, kind, copy }: RowContext): RowText => {
  if (inspection.group === "two_copies") {
    return {
      label: `${item} stays in its new place`,
      hint: copy
        ? `The old copy becomes ${copy}`
        : "Empty folders at the old place are removed",
    };
  }
  if (inspection.group === "no_copy") {
    return {
      label: kind.endsWith("purge")
        ? `${item} is deleted forever`
        : "The change finishes",
      hint: "There is nothing left on the disk",
    };
  }
  return {
    label: "The change finishes",
    hint: copy
      ? `What is in the way becomes ${copy}`
      : "Empty folders in the way are removed",
  };
};

const undoRow = ({
  inspection,
  item,
  copy,
  size,
  atOldPlace,
}: RowContext): RowText => {
  if (inspection.group === "broken") {
    return { label: "Everything goes back to where it was" };
  }
  const asItIs = size ? `As it is now, ${size}` : undefined;
  return {
    label: atOldPlace
      ? `${item} stays in its old place`
      : `${item} goes back to its old place`,
    hint: copy ? `The new copy becomes ${copy}` : asItIs,
  };
};

const rowTexts: Record<ChoiceId, (context: RowContext) => RowText | null> = {
  finish: finishRow,
  keep: ({ item, size, atOldPlace }) => ({
    label: `${item} stays as it is now${size ? `, ${size}` : ""}`,
    hint: atOldPlace
      ? "Then it moves to its new place"
      : "It stays in its new place",
  }),
  undo: undoRow,
  remove: ({ item, owner, kind }) =>
    kind.startsWith("upload")
      ? {
          label: "This upload is dropped",
          hint: "None of it reached the disk",
          destructive: true,
        }
      : {
          label: `${item} leaves ${owner}'s drive`,
          hint: "There is nothing on the disk to delete",
          destructive: true,
        },
  // Check again sits in the header.
  retry: () => null,
};

const copyOf = (choice: Inspection["choices"][number]) => {
  if (choice.copyName) return choice.copyName;
  return choice.copyCount ? `${choice.copyCount} copies` : null;
};

const choiceRowsOf = (
  inspection: Inspection,
  item: string,
  owner: string,
  kind: string,
): ChoiceRow[] => {
  const changed = inspection.places.find((place) => place.state === "changed");
  const base = {
    inspection,
    item,
    owner,
    kind,
    size: changed ? sizeOf(changed) : null,
    atOldPlace: changed?.role === "old",
  };
  return inspection.choices.flatMap((choice) => {
    const text = rowTexts[choice.id]({ ...base, copy: copyOf(choice) });
    return text ? [{ id: choice.id, ...text }] : [];
  });
};

const resultToasts = {
  fixed: { title: "Change fixed", type: "success" },
  running: { title: "Finishing the change", type: "info" },
  stopped: { title: "It stopped again", type: "warning" },
  changed: { title: "The disk changed. Look again.", type: "warning" },
  busy: { title: "Staaash is still working on this change", type: "info" },
} as const;

const statusBadges: Record<
  string,
  { variant: "error" | "success"; label: string }
> = {
  recovery_required: { variant: "error", label: "Needs review" },
  succeeded: { variant: "success", label: "Fixed" },
  aborted: { variant: "success", label: "Undone" },
};

const isDone = (status: string) =>
  status === "succeeded" || status === "aborted";

const refetchWhileBusy = (query: { state: { data?: Change } }) => {
  const data = query.state.data;
  if (!data) return false;
  const stopped = data.status === "recovery_required";
  const busy = stopped ? !data.inspection : !isDone(data.status);
  return busy ? 2_000 : false;
};

const doneText = (change: Change) => {
  if (!isDone(change.status)) return "Staaash is finishing this change.";
  const fix = change.fixes.at(-1);
  if (!fix) return "This change is finished.";
  const who = fix.automatic
    ? "Staaash fixed this by itself"
    : `${fix.byName ?? "The owner"} fixed this`;
  const kept = fix.kept.length
    ? ` ${plural(fix.kept.length, "copy")} kept in ${change.ownerName}'s drive.`
    : "";
  return `${who} on ${shortDate(fix.at)}.${kept}`;
};

function ChangeSummary({ change, item }: { change: Change; item: string }) {
  if (change.status !== "recovery_required") {
    return (
      <p className="m-0 text-body text-muted-foreground">{doneText(change)}</p>
    );
  }
  if (!change.inspection) {
    return (
      <p className="m-0 flex items-center gap-2 text-body text-muted-foreground">
        <Spinner className="size-4" />
        Checking the disk
      </p>
    );
  }
  return <p className="m-0 text-body">{summaryOf(change.inspection, item)}</p>;
}

function InspectionDetails({
  inspection,
  item,
}: {
  inspection: Inspection;
  item: string;
}) {
  const unsafePlace = inspection.places.find(
    (place) => place.state === "unsafe",
  );
  return (
    <>
      {inspection.places.length ? (
        <Group title="On disk">
          <SettingsCard>
            {inspection.places.map((place) => (
              <SettingsRow
                hint={[place.label, sizeOf(place)].filter(Boolean).join(" · ")}
                key={`${place.role}:${place.label}`}
                label={placeRoles[place.role]}
              >
                <PlaceBadge place={place} />
              </SettingsRow>
            ))}
          </SettingsCard>
        </Group>
      ) : null}

      {inspection.group === "unsafe" ? (
        <Group title="Fix it on the server">
          <SettingsCard>
            <SettingsRow
              label={serverStepOf(inspection, unsafePlace?.label ?? item)}
            />
            <SettingsRow label="Then click Check again." />
          </SettingsCard>
        </Group>
      ) : null}

      {inspection.waitingFor ? (
        <Button
          className="justify-self-start"
          render={
            <AppLink href={`/admin/storage/changes/${inspection.waitingFor}`} />
          }
          size="sm"
          variant="outline"
        >
          Open the other change
        </Button>
      ) : null}

      {inspection.tooBig ? (
        <p className="m-0 text-body text-muted-foreground">
          Some choices touch too many files and folders to run from here yet.
          Leave it as it is; nothing is lost while it waits.
        </p>
      ) : null}

      {inspection.noLinks ? (
        <p className="m-0 text-body text-muted-foreground">
          This storage has no hard links, so Staaash cannot move a file aside
          without risking the file in its place. Leave it as it is; nothing is
          lost while it waits.
        </p>
      ) : null}
    </>
  );
}

const choiceVariant = (row: ChoiceRow, index: number) => {
  if (row.destructive) return "destructive-outline";
  return index === 0 ? "default" : "outline";
};

function ChoiceList({
  rows,
  canFix,
  pending,
  onChoose,
}: {
  rows: ChoiceRow[];
  canFix: boolean;
  pending: ChoiceId | null;
  onChoose: (row: ChoiceRow) => void;
}) {
  return (
    <Group title="Choose">
      <SettingsCard>
        {rows.map((row, index) => (
          <SettingsRow hint={row.hint} key={row.id} label={row.label}>
            {canFix ? (
              <Button
                disabled={pending !== null}
                loading={pending === row.id}
                onClick={() => onChoose(row)}
                size="sm"
                variant={choiceVariant(row, index)}
              >
                {words(row.id)}
              </Button>
            ) : null}
          </SettingsRow>
        ))}
      </SettingsCard>
    </Group>
  );
}

const confirmRemoval = (item: string, owner: string) =>
  confirmAction({
    title: `Remove ${item} from ${owner}'s drive?`,
    description:
      "Staaash found no copy on the disk, so nothing is deleted. Only the entry goes away.",
    confirmLabel: "Remove",
    destructive: true,
  });

const showResult = (result: keyof typeof resultToasts, choice: ChoiceId) => {
  const toast = resultToasts[result];
  const undone = result === "fixed" && choice === "undo";
  toastManager.add({
    title: undone ? "Change undone" : toast.title,
    type: toast.type,
  });
};

function useChoice(
  mutationId: string,
  item: string,
  owner: string,
  seen: string | null,
) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<ChoiceId | null>(null);
  const choose = async (row: { id: ChoiceId; destructive?: boolean }) => {
    if (row.destructive && !(await confirmRemoval(item, owner))) return;
    setPending(row.id);
    try {
      const { result } = await read(
        api.api.admin.storage.mutations[":mutationId"].review.$post({
          param: { mutationId },
          json: { choice: row.id, seen },
        }),
      );
      showResult(result, row.id);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["admin", "storage"] }),
        queryClient.invalidateQueries({ queryKey: ["recovered-notice"] }),
      ]);
      if (result === "fixed" || result === "running") {
        await navigate({ href: "/admin/storage" });
      }
    } catch (error) {
      toastManager.add({
        title: error instanceof Error ? error.message : "The fix failed.",
        type: "error",
      });
    } finally {
      setPending(null);
    }
  };
  return { pending, choose };
}

const detailsOf = (change: Change) =>
  [
    `Operation: ${change.id}`,
    `Kind: ${change.kind}`,
    `Status: ${change.status}`,
    `Error: ${change.lastError || "No error was recorded."}`,
    ...(change.inspection?.places ?? []).map(
      (place) => `${placeRoles[place.role]}: ${place.label} (${place.state})`,
    ),
  ].join("\n");

function ChangeHeader({
  change,
  actions,
}: {
  change: Change;
  actions: ReactNode;
}) {
  const badge = statusBadges[change.status] ?? {
    variant: "warning",
    label: "Finishing",
  };
  return (
    <div className="grid gap-3">
      <Button
        className="-ms-2 justify-self-start"
        render={<AppLink href="/admin/storage" />}
        size="sm"
        variant="ghost-muted"
      >
        <ChevronLeft aria-hidden />
        Storage
      </Button>
      <PageHeader
        actions={actions}
        description={`${change.ownerName} · ${shortDate(change.stoppedAt ?? change.createdAt)}`}
        meta={<Badge variant={badge.variant}>{badge.label}</Badge>}
        title={words(change.kind)}
      />
    </div>
  );
}

function useChangePage(mutationId: string) {
  const change = useSuspenseQuery({
    ...adminStorageChangeQuery(mutationId),
    refetchInterval: refetchWhileBusy,
  }).data;
  const item = change.inspection?.itemName ?? "This item";
  const stopped = change.status === "recovery_required";
  const inspection = stopped ? change.inspection : null;
  const choice = useChoice(
    mutationId,
    item,
    change.ownerName,
    inspection?.seen ?? null,
  );
  const rows = inspection
    ? choiceRowsOf(inspection, item, change.ownerName, change.kind)
    : [];
  return {
    ...choice,
    change,
    item,
    inspection,
    rows,
    stopped,
    isOwner: change.isOwner,
  };
}

function CheckAgain({
  inspection,
  rows,
  pending,
  onRetry,
}: {
  inspection: Inspection | null;
  rows: ChoiceRow[];
  pending: ChoiceId | null;
  onRetry: () => void;
}) {
  // The main action when there is nothing else to choose.
  const secondary = rows.length > 0 || inspection?.group === "waiting";
  return (
    <Button
      disabled={pending !== null || !inspection}
      onClick={onRetry}
      size="sm"
      variant={secondary ? "outline" : "default"}
    >
      Check again
    </Button>
  );
}

export function StorageChangePage({ mutationId }: { mutationId: string }) {
  const page = useChangePage(mutationId);
  const canFix = page.isOwner && page.stopped;
  return (
    <div className="grid w-full max-w-3xl content-start gap-6">
      <ChangeHeader
        actions={
          <>
            <UserDetailCopyButton
              label="details"
              value={detailsOf(page.change)}
            />
            {canFix ? (
              <CheckAgain
                inspection={page.inspection}
                onRetry={() => void page.choose({ id: "retry" })}
                pending={page.pending}
                rows={page.rows}
              />
            ) : null}
          </>
        }
        change={page.change}
      />
      <ChangeSummary change={page.change} item={page.item} />
      {page.inspection ? (
        <InspectionDetails inspection={page.inspection} item={page.item} />
      ) : null}
      {page.rows.length ? (
        <ChoiceList
          canFix={canFix}
          onChoose={(row) => void page.choose(row)}
          pending={page.pending}
          rows={page.rows}
        />
      ) : null}
      {page.stopped && !page.isOwner ? (
        <p className="m-0 text-body text-muted-foreground">
          Only the owner can fix this change.
        </p>
      ) : null}
    </div>
  );
}
