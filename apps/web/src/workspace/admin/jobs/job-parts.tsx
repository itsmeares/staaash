import { cn } from "@staaash/ui/utils";

export type JobTone =
  | "idle"
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

const JOB_TONE_DOT: Record<JobTone, string> = {
  idle: "bg-muted-foreground",
  queued: "bg-warning",
  running: "bg-info",
  succeeded: "bg-success",
  failed: "bg-destructive",
  cancelled: "bg-muted-foreground",
};

export function JobDot({ tone }: { tone: JobTone }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex size-2 shrink-0 rounded-full",
        JOB_TONE_DOT[tone],
      )}
    />
  );
}

export const JOB_NOTE = "m-0 text-label text-muted-foreground md:text-meta";
