import { cn } from "@/lib/utils";

export type JobTone =
  "idle" | "queued" | "running" | "succeeded" | "failed" | "cancelled";

const JOB_TONE_DOT: Record<JobTone, string> = {
  idle: "bg-muted-foreground",
  queued: "bg-warning",
  running: "bg-info",
  succeeded: "bg-success",
  failed: "bg-destructive",
  cancelled: "bg-muted-foreground",
};

export const JOB_TONE_TEXT: Record<JobTone, string> = {
  idle: "text-muted-foreground",
  queued: "text-warning-foreground",
  running: "text-info-foreground",
  succeeded: "text-success-foreground",
  failed: "text-destructive-foreground",
  cancelled: "text-muted-foreground",
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

export function ModalHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="m-0 mb-2.5 font-sans text-xs font-semibold tracking-wider text-muted-foreground uppercase md:text-label">
      {children}
    </h3>
  );
}
