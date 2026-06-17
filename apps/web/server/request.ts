import { env } from "@/lib/env";

export function getBaseUrl(headers: {
  get(name: string): string | null;
}): string {
  const proto = headers.get("x-forwarded-proto") ?? "http";
  const host =
    headers.get("x-forwarded-host") ?? headers.get("host") ?? "localhost";
  return `${proto}://${host}`;
}

export function getShareBaseUrl(headers: {
  get(name: string): string | null;
}): string {
  return env.STAAASH_PUBLIC_URL ?? getBaseUrl(headers);
}

export function getRequestSessionMetadata(headers: {
  get(name: string): string | null;
}) {
  const forwardedFor = headers.get("x-forwarded-for");
  const ipAddress =
    forwardedFor?.split(",")[0]?.trim() ||
    headers.get("x-real-ip")?.trim() ||
    null;

  return {
    userAgent: headers.get("user-agent"),
    ipAddress,
  };
}
