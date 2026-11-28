import type { ReactNode } from "react";

import { cn } from "@staaash/ui/utils";

const DOT = {
  ok: "bg-success",
  warning: "bg-warning",
  error: "bg-destructive",
  idle: "bg-muted-foreground",
} as const;

/** A dot that only takes a color when something needs attention. */
function StatusDot({ tone }: { tone: keyof typeof DOT }) {
  return (
    <span
      aria-hidden
      className={cn("size-2 shrink-0 rounded-full", DOT[tone])}
    />
  );
}

/** Every admin page shares one width, so switching pages keeps the edges still. */
export function AdminPage({ children }: { children: ReactNode }) {
  return (
    <div className="grid w-full max-w-5xl grid-cols-1 content-start gap-6">
      {children}
    </div>
  );
}

export function AdminGroup({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="grid gap-2.5">
      <h2 className="m-0 font-heading text-body font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export function AdminRow({
  tone,
  label,
  detail,
  action,
}: {
  tone?: keyof typeof DOT;
  label: ReactNode;
  detail?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex min-h-11 items-center gap-x-3 border-t border-border px-3.5 py-2 first:border-t-0">
      {tone ? <StatusDot tone={tone} /> : null}
      <span className="shrink-0 text-body font-medium">{label}</span>
      {detail ? (
        <span className="ms-auto min-w-0 text-end text-meta text-muted-foreground">
          {detail}
        </span>
      ) : null}
      {action ? (
        <span className={detail ? undefined : "ms-auto"}>{action}</span>
      ) : null}
    </div>
  );
}

/** Status words to dot tones. */
export const toneFor = (status: string): keyof typeof DOT =>
  ["healthy", "ok", "ready", "succeeded", "up-to-date", "active"].includes(
    status,
  )
    ? "ok"
    : ["warning", "stale", "update-available", "queued", "accepted"].includes(
          status,
        )
      ? "warning"
      : ["idle", "unavailable", "not checked", "cancelled", "stopped"].includes(
            status,
          )
        ? "idle"
        : "error";
