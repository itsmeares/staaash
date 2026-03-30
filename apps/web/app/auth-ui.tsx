import type { ReactNode } from "react";

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
  return <div className={`banner banner-${tone}`}>{children}</div>;
}
