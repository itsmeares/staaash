import { createContext, useContext, useEffect, useMemo, useState } from "react";

import {
  getBrowserTimeZone,
  isValidTimeZone,
} from "@staaash/config/time-zone";

import { formatDateTime, formatDayMonth } from "@/lib/time";

type TimeContextValue = { now: Date; timeZone: string; clock: string };

const TimeContext = createContext<TimeContextValue | null>(null);

const TICK_MS = 30_000;

/** Dates in the person's chosen zone, or the browser's when they chose automatic. */
export function TimeProvider({
  children,
  timeZone: preference,
  clock = "24h",
}: {
  children: React.ReactNode;
  /** "12h" or "24h", from Settings → Date and time. */
  clock?: string;
  /** The saved zone; anything that is not a zone name means automatic. */
  timeZone?: string | null;
}) {
  const [nowMs, setNowMs] = useState(Date.now);
  const timeZone =
    preference && isValidTimeZone(preference)
      ? preference
      : getBrowserTimeZone();

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, []);

  const value = useMemo(
    () => ({ now: new Date(nowMs), timeZone, clock }),
    [nowMs, timeZone, clock],
  );

  return <TimeContext value={value}>{children}</TimeContext>;
}

export function useTime(): TimeContextValue {
  const value = useContext(TimeContext);
  if (!value) throw new Error("useTime must be used inside <TimeProvider>.");
  return value;
}

/** "17 Oct" in the viewer's zone. */
export function DayMonth({ value }: { value: Date | string }) {
  const { timeZone } = useTime();
  const date = typeof value === "string" ? new Date(value) : value;
  return (
    <time dateTime={date.toISOString()}>{formatDayMonth(date, timeZone)}</time>
  );
}

export function DateTime({ value }: { value: Date | string }) {
  const { timeZone, clock } = useTime();
  const date = typeof value === "string" ? new Date(value) : value;
  return (
    <time dateTime={date.toISOString()}>
      {formatDateTime(date, timeZone, clock)}
    </time>
  );
}
