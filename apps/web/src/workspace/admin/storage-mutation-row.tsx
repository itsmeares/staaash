import { useState } from "react";
import { api, read } from "@/lib/api";
import { useRefresh } from "@/lib/use-refresh";
import { adminStorageQuery } from "@/src/queries";
import { Badge } from "@staaash/ui/components/badge";
import { Button } from "@staaash/ui/components/button";
import { toast } from "@staaash/ui/components/toast";
import { UserDetailCopyButton } from "./user-detail-copy-button";

const words = (value: string) =>
  value.charAt(0).toUpperCase() + value.slice(1).replaceAll("_", " ");

type Mutation = Awaited<
  ReturnType<ReturnType<typeof adminStorageQuery>["queryFn"] & {}>
>["mutations"][number];

/** Asks the journal to try an unfinished change again now. */
function RetryButton({ mutationId }: { mutationId: string }) {
  const refresh = useRefresh();
  const [pending, setPending] = useState(false);
  return (
    <Button
      disabled={pending}
      onClick={async () => {
        setPending(true);
        try {
          await read(
            api.api.admin.storage.mutations[":mutationId"].retry.$post({
              param: { mutationId },
            }),
          );
          await refresh();
        } catch (error) {
          toast.error(error instanceof Error ? error.message : "Retry failed.");
        } finally {
          setPending(false);
        }
      }}
      size="sm"
      variant="outline"
    >
      Retry now
    </Button>
  );
}

export function MutationRow({
  mutation,
  owner,
  isOwner,
}: {
  mutation: Mutation;
  owner: string;
  isOwner: boolean;
}) {
  const recovery = mutation.status === "recovery_required";
  const diagnostics = [
    `Operation: ${mutation.id}`,
    `Kind: ${mutation.kind}`,
    `Status: ${mutation.status}`,
    `Error: ${mutation.lastError || "No error was recorded."}`,
    ...mutation.safePathLabels.map((label) => `Path: ${label}`),
  ].join("\n");
  return (
    <div className="grid gap-3 border-t border-border px-4 py-3.5 first:border-t-0">
      <div className="flex flex-wrap items-center gap-3">
        <span className="min-w-0 flex-1 text-body font-medium">
          {words(mutation.kind)} · {owner}
        </span>
        <Badge variant={recovery ? "error" : "warning"}>
          {recovery ? "Needs review" : words(mutation.status)}
        </Badge>
        {!recovery && mutation.canRetryNow && isOwner ? (
          <RetryButton mutationId={mutation.id} />
        ) : null}
      </div>
      <div className="grid min-w-0 gap-3 text-body">
        {recovery ? (
          <>
            <p className="m-0 text-muted-foreground">
              Staaash stopped this change to avoid risking your files. It needs
              manual review and will not finish by waiting or refreshing.
            </p>
            <p className="m-0 break-words whitespace-pre-wrap">
              {mutation.lastError || "No error was recorded."}
            </p>
          </>
        ) : (
          <p className="m-0 text-muted-foreground">Finishing on its own</p>
        )}
        {mutation.safePathLabels.length ? (
          <p className="m-0 text-label break-words text-muted-foreground">
            {mutation.safePathLabels.join(", ")}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <code className="min-w-0 text-label break-all text-muted-foreground">
            {mutation.id}
          </code>
          <UserDetailCopyButton label="recovery details" value={diagnostics} />
        </div>
        {recovery ? (
          <p className="m-0 text-muted-foreground">
            {isOwner
              ? "Check the worker logs for this operation ID and follow the storage recovery guide. Copy these details if you need help. Do not move or delete storage files by hand."
              : "Give these details to the instance owner. They need to check the worker logs and follow the storage recovery guide. Do not move or delete storage files by hand."}{" "}
            <a
              className="underline underline-offset-4"
              href="https://github.com/itsmeares/staaash/blob/main/docs/operations/storage-mutation-recovery.md#operator-actions"
              target="_blank"
              rel="noopener noreferrer"
            >
              Storage recovery guide
            </a>
          </p>
        ) : null}
      </div>
    </div>
  );
}
