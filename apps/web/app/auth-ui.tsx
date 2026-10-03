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

export const formatDateTime = (value: Date | string, timeZone?: string) =>
  new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    ...(timeZone ? { timeZone } : {}),
  }).format(typeof value === "string" ? new Date(value) : value);

export function FlashMessage({
  children,
  tone = "error",
}: {
  children: ReactNode;
  tone?: "error" | "info" | "success";
}) {
  const config = {
    error: { title: "There was a problem", variant: "error" as const },
    info: { title: "Heads up", variant: "info" as const },
    success: { title: "Success", variant: "success" as const },
  }[tone];

  return (
    <Alert variant={config.variant}>
      <AlertTitle>{config.title}</AlertTitle>
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}
