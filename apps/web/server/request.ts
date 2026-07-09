import { env } from "@/lib/env";

type HeaderGetter = {
  get(name: string): string | null;
};

const getForwardedProtocol = (headers: HeaderGetter): "http" | "https" => {
  const protocol = headers.get("x-forwarded-proto")?.trim().toLowerCase();

  return protocol === "https" ? "https" : "http";
};

const getRequestHost = (headers: HeaderGetter) => {
  const host = headers.get("host")?.trim();

  if (
    !host ||
    host.includes("/") ||
    host.includes("\\") ||
    /[\s,@]/.test(host)
  ) {
    return "localhost";
  }

  try {
    return new URL(`http://${host}`).host;
  } catch {
    return "localhost";
  }
};

export function getBaseUrl(headers: {
  get(name: string): string | null;
}): string {
  return `${getForwardedProtocol(headers)}://${getRequestHost(headers)}`;
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
