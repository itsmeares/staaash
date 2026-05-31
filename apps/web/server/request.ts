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
