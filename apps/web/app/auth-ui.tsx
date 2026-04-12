import type { ReactNode } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export const getSingleSearchParam = (
  params: Record<string, string | string[] | undefined>,
  key: string,
) => {
  const value = params[key];

  return Array.isArray(value) ? value[0] : value;
};

export const getSafeLocalPath = (
  value: string | undefined,
  fallback: string,
) => {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return fallback;
  }

  return value;
};

export const formatDateTime = (value: Date | string) =>
  new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(typeof value === "string" ? new Date(value) : value);

export function FlashMessage({
  children,
  tone = "error",
}: {
  children: ReactNode;
  tone?: "error" | "info" | "success";
}) {
  const config = {
    error: {
      title: "There was a problem",
      variant: "destructive" as const,
      className: "border-destructive/30 bg-destructive/10",
    },
    info: {
      title: "Heads up",
      variant: "default" as const,
      className:
        "border-primary/20 bg-primary/10 text-card-foreground [&_[data-slot=alert-description]]:text-muted-foreground",
    },
    success: {
      title: "Success",
      variant: "default" as const,
      className:
        "border-emerald-500/20 bg-emerald-500/10 text-card-foreground [&_[data-slot=alert-description]]:text-muted-foreground",
    },
  }[tone];

  return (
    <Alert className={config.className} variant={config.variant}>
      <AlertTitle>{config.title}</AlertTitle>
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}
