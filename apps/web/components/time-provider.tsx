"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";

import {
  TIME_ZONE_COOKIE_NAME,
  getBrowserTimeZone,
} from "@staaash/config/time-zone";

import { formatDateTime } from "@/lib/time";

type TimeContextValue = { now: Date; timeZone: string };

const TimeContext = createContext<TimeContextValue | null>(null);

const TICK_MS = 30_000;

// The first client render must reuse the server's zone and clock, or React
// throws #418. After hydration the clock ticks and, when the user's zone is
// automatic, switches to the browser zone and remembers it for the next
// server render.
export function TimeProvider({
  autoDetect,
  children,
  serverNow,
  timeZone: serverTimeZone,
}: {
  autoDetect: boolean;
  children: React.ReactNode;
  serverNow: number;
  timeZone: string;
}) {
  const [nowMs, setNowMs] = useState(serverNow);
  const [timeZone, setTimeZone] = useState(serverTimeZone);

  useEffect(() => {
    if (!autoDetect) {
      setTimeZone(serverTimeZone);
      return;
    }
    const browserTimeZone = getBrowserTimeZone();
    // IANA names are cookie-safe, no encoding needed.
    document.cookie = `${TIME_ZONE_COOKIE_NAME}=${browserTimeZone}; path=/; max-age=31536000; samesite=lax${
      location.protocol === "https:" ? "; secure" : ""
    }`;
    setTimeZone(browserTimeZone);
  }, [autoDetect, serverTimeZone]);

  useEffect(() => {
    setNowMs(Date.now());
    const id = setInterval(() => setNowMs(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, []);

  const value = useMemo(
    () => ({ now: new Date(nowMs), timeZone }),
    [nowMs, timeZone],
  );

  return <TimeContext value={value}>{children}</TimeContext>;
}

export function useTime(): TimeContextValue {
  const value = useContext(TimeContext);
  if (!value) throw new Error("useTime must be used inside <TimeProvider>.");
  return value;
}

// Absolute date and time in the viewer's zone. Usable from server components.
export function DateTime({ value }: { value: Date | string }) {
  const { timeZone } = useTime();
  const date = typeof value === "string" ? new Date(value) : value;
  return (
    <time dateTime={date.toISOString()}>{formatDateTime(date, timeZone)}</time>
  );
}
