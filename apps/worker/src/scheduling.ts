import { TZDate } from "@date-fns/tz";
import { addDays } from "date-fns";

import {
  normalizeMaintenanceRunTime,
  normalizeTimeZone,
  parseMaintenanceRunTime,
} from "@staaash/config/time-zone";

export type DailyScheduleInput = {
  timeZone: string;
  localTime: string;
  now: Date;
};

export const nextDailyRunAtUtc = ({
  timeZone,
  localTime,
  now,
}: DailyScheduleInput) => {
  const zone = normalizeTimeZone(timeZone);
  const { hour, minute } = parseMaintenanceRunTime(localTime);
  const zonedNow = new TZDate(now.getTime(), zone);
  let candidate = new TZDate(
    zonedNow.getFullYear(),
    zonedNow.getMonth(),
    zonedNow.getDate(),
    hour,
    minute,
    0,
    0,
    zone,
  );

  if (candidate.getTime() <= now.getTime()) {
    candidate = addDays(candidate, 1);
  }

  return new Date(candidate.getTime());
};

export const nextDailyWindowEndUtc = ({
  timeZone,
  localTime,
  runAt,
}: {
  timeZone: string;
  localTime: string;
  runAt: Date;
}) => {
  const zone = normalizeTimeZone(timeZone);
  const normalizedLocalTime = normalizeMaintenanceRunTime(localTime);
  const { hour, minute } = parseMaintenanceRunTime(normalizedLocalTime);
  const runAtInZone = new TZDate(runAt.getTime(), zone);
  const nextRun = addDays(
    new TZDate(
      runAtInZone.getFullYear(),
      runAtInZone.getMonth(),
      runAtInZone.getDate(),
      hour,
      minute,
      0,
      0,
      zone,
    ),
    1,
  );

  return new Date(nextRun.getTime());
};
