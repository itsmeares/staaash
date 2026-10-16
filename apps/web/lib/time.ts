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

const clockFormatters = new Map<string, Intl.DateTimeFormat>();

/** "10:51" (or "10:51 AM"): the time of day, for lists grouped by day. */
function formatClock(value: DateInput, timeZone: string, clock = "24h") {
  const key = `${timeZone}|${clock}`;
  let formatter = clockFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: clock === "12h",
      timeZone,
    });
    clockFormatters.set(key, formatter);
  }
  return formatter.format(toDate(value));
}

/** The time within this week's day groups, the date further back. */
export function formatGroupedTime(
  value: DateInput,
  now: Date,
  timeZone: string,
  clock = "24h",
) {
  return getDateGroup(value, now, timeZone).rank < 7
    ? formatClock(value, timeZone, clock)
    : formatShortDate(value, timeZone);
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

const monthFormatters = new Map<string, Intl.DateTimeFormat>();

// The weekday, month and year `date` falls on in `timeZone`.
function zonedParts(date: Date, timeZone: string) {
  let formatter = monthFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en", {
      month: "long",
      weekday: "long",
      year: "numeric",
      timeZone,
    });
    monthFormatters.set(timeZone, formatter);
  }
  const parts = formatter.formatToParts(date);
  const part = (type: string) =>
    parts.find((entry) => entry.type === type)?.value ?? "";
  return {
    weekday: part("weekday"),
    month: part("month"),
    year: Number(part("year")),
  };
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/**
 * Calendar buckets in the viewer's zone: Today, Yesterday, the weekday names
 * of this week (weeks start on Monday), then months, with the year when it
 * is not this year. `rank` grows with age, so buckets sort newest first.
 * Exported for its test.
 */
// fallow-ignore-next-line unused-export
export function getDateGroup(
  value: DateInput,
  now: Date,
  timeZone: string,
): { label: string; rank: number } {
  const date = toDate(value);
  const today = zonedDayNumber(now, timeZone);
  const days = Math.max(0, today - zonedDayNumber(date, timeZone));

  if (days === 0) return { label: "Today", rank: 0 };
  if (days === 1) return { label: "Yesterday", rank: 1 };

  // 1970-01-01 was a Thursday; (day + 3) % 7 is 0 on Mondays.
  const daysSinceMonday = (today + 3) % 7;
  const then = zonedParts(date, timeZone);
  if (days <= daysSinceMonday) return { label: then.weekday, rank: days };

  const current = zonedParts(now, timeZone);
  const monthsAgo =
    current.year * 12 +
    MONTHS.indexOf(current.month) -
    (then.year * 12 + MONTHS.indexOf(then.month));
  return {
    label:
      then.year === current.year ? then.month : `${then.month} ${then.year}`,
    rank: 7 + monthsAgo,
  };
}

/** Items in date buckets; `oldestFirst` flips the bucket order. */
export function groupByDate<T>(
  items: T[],
  dateOf: (item: T) => DateInput,
  now: Date,
  timeZone: string,
  oldestFirst = false,
): { label: string; items: T[] }[] {
  const groups = new Map<string, { rank: number; items: T[] }>();
  for (const item of items) {
    const { label, rank } = getDateGroup(dateOf(item), now, timeZone);
    const group = groups.get(label) ?? { rank, items: [] };
    group.items.push(item);
    groups.set(label, group);
  }
  return [...groups.entries()]
    .sort(([, a], [, b]) => (oldestFirst ? b.rank - a.rank : a.rank - b.rank))
    .map(([label, group]) => ({ label, items: group.items }));
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
