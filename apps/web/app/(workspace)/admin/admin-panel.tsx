import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/utils";

/** A bordered surface for one admin topic, with an optional heading. */
export function AdminPanel({
  title,
  aside,
  className,
  children,
  ...props
}: Omit<ComponentProps<"section">, "title"> & {
  title?: string;
  aside?: ReactNode;
}) {
  return (
    <section
      className={cn(
        "grid min-w-0 grid-cols-1 gap-3 rounded-xl border border-border bg-card p-4",
        className,
      )}
      {...props}
    >
      {title ? (
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="m-0 font-sans text-body font-semibold">{title}</h2>
          {aside ? (
            <p className="m-0 text-right text-meta text-muted-foreground">
              {aside}
            </p>
          ) : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

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
