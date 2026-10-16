// Date formatting shared by server and client components. Every function
// takes the time zone and the reference "now" explicitly: reading the runtime
// zone or clock during render makes server and browser text disagree (#418).

type DateInput = Date | string;

const toDate = (value: DateInput) =>
  value instanceof Date ? value : new Date(value);

const DAY_MS = 24 * 60 * 60 * 1000;

const dayKeyFormatters = new Map<string, Intl.DateTimeFormat>();
const dateTimeFormatters = new Map<string, Intl.DateTimeFormat>();
const shortDateFormatters = new Map<string, Intl.DateTimeFormat>();

// Days since 1970-01-01 for the calendar date `date` falls on in `timeZone`.
function zonedDayNumber(date: Date, timeZone: string) {
  let formatter = dayKeyFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      day: "2-digit",
      month: "2-digit",
      timeZone,
      year: "numeric",
    });
    dayKeyFormatters.set(timeZone, formatter);
  }
  const [year, month, day] = formatter.format(date).split("-").map(Number);
  return Date.UTC(year, month - 1, day) / DAY_MS;
}

export function formatDateTime(
  value: DateInput,
  timeZone: string,
  clock: string = "24h",
) {
  const key = `${timeZone}|${clock}`;
  let formatter = dateTimeFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-GB", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone,
      hour12: clock === "12h",
    });
    dateTimeFormatters.set(key, formatter);
  }
  return formatter.format(toDate(value));
}

function formatShortDate(value: DateInput, timeZone: string) {
  let formatter = shortDateFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en", {
      day: "numeric",
      month: "short",
      timeZone,
    });
    shortDateFormatters.set(timeZone, formatter);
  }
  return formatter.format(toDate(value));
}

const plural = (count: number, unit: string) =>
  `${count} ${unit}${count === 1 ? "" : "s"} ago`;

const RELATIVE_UNITS = {
  short: {
    minutes: (n: number) => `${n}m ago`,
    hours: (n: number) => `${n}h ago`,
  },
  long: {
    minutes: (n: number) => plural(n, "min"),
    hours: (n: number) => plural(n, "hour"),
  },
};

// "short" gives "5m ago" / "2h ago"; "long" gives "5 mins ago" / "2 hours ago".
export function formatRelativeTime(
  value: DateInput,
  now: Date,
  timeZone: string,
  style: keyof typeof RELATIVE_UNITS = "short",
): string {
  const date = toDate(value);
  const diffMinutes = Math.floor(
    Math.max(0, now.getTime() - date.getTime()) / 60000,
  );
  const units = RELATIVE_UNITS[style];

  if (diffMinutes < 1) return "Just now";
  if (diffMinutes < 60) return units.minutes(diffMinutes);

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return units.hours(diffHours);

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;

  return formatShortDate(date, timeZone);
}

export type DateGroupLabel =
  | "Today"
  | "Yesterday"
  | "This week"
  | "This month"
  | "Older";

export const DATE_GROUP_ORDER: DateGroupLabel[] = [
  "Today",
  "Yesterday",
  "This week",
  "This month",
  "Older",
];

// Calendar buckets in the viewer's zone. Weeks start on Monday.
export function getDateGroup(
  value: DateInput,
  now: Date,
  timeZone: string,
): DateGroupLabel {
  const today = zonedDayNumber(now, timeZone);
  const days = Math.max(0, today - zonedDayNumber(toDate(value), timeZone));

  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";

  // 1970-01-01 was a Thursday; (day + 3) % 7 is 0 on Mondays.
  const daysSinceMonday = (today + 3) % 7;
  if (days <= daysSinceMonday) return "This week";
  if (days < 30) return "This month";
  return "Older";
}

const MINUTES_UNTIL: [unit: string, size: number, below: number][] = [
  ["minute", 1, 60],
  ["hour", 60, 24 * 60],
  ["day", 24 * 60, 7 * 24 * 60],
  ["week", 7 * 24 * 60, 9 * 7 * 24 * 60],
  ["month", 30 * 24 * 60, 365 * 24 * 60],
  ["year", 365 * 24 * 60, Infinity],
];

/** "5 minutes", "2 weeks": how long until a share link stops working. */
export function formatTimeUntil(value: Date | string, now: Date): string {
  const minutes = Math.ceil(
    (new Date(value).getTime() - now.getTime()) / 60_000,
  );
  if (minutes <= 0) return "expired";
  const [unit, size] = MINUTES_UNTIL.find(([, , below]) => minutes < below)!;
  const count = Math.ceil(minutes / size);
  return `${count} ${unit}${count === 1 ? "" : "s"}`;
}
