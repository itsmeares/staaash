export type Device = {
  id: string;
  /** "Firefox on Linux". */
  device: string;
  ipAddress: string | null;
  lastSeenAt: string | null;
  createdAt: string;
  current: boolean;
};

const BROWSERS: Array<[RegExp, string]> = [
  [/Edg\//, "Edge"],
  [/OPR\//, "Opera"],
  [/Firefox\//, "Firefox"],
  [/Chrome\//, "Chrome"],
  [/Safari\//, "Safari"],
];
const SYSTEMS: Array<[RegExp, string]> = [
  [/iPhone/, "iPhone"],
  [/iPad/, "iPad"],
  [/Android/, "Android"],
  [/Windows/, "Windows"],
  [/Mac OS X|Macintosh/, "macOS"],
  [/CrOS/, "ChromeOS"],
  [/Linux/, "Linux"],
];

/** "Firefox on Linux", from a session's user agent. */
// Each fallback is one short branch; splitting them hides the order.
// fallow-ignore-next-line complexity
function describeDevice(userAgent: string | null | undefined) {
  if (!userAgent) return "Unknown browser";
  const browser = BROWSERS.find(([pattern]) => pattern.test(userAgent))?.[1];
  const system = SYSTEMS.find(([pattern]) => pattern.test(userAgent))?.[1];
  if (browser && system) return `${browser} on ${system}`;
  return browser ?? system ?? "Unknown browser";
}

/** An IPv4 address the way people write it, not IPv4-mapped IPv6. */
const formatSessionIp = (value: string | null) => {
  if (!value) return null;

  if (value.startsWith("::ffff:")) {
    return value.slice("::ffff:".length);
  }

  return value;
};

/** A stored session as the device list shows it. */
export const toDevice = (
  session: {
    id: string;
    userAgent: string | null;
    ipAddress: string | null;
    lastSeenAt: Date | null;
    deviceName: string | null;
    createdAt: Date;
  },
  current: { id: string; deviceSessionId: string | null },
): Device => ({
  id: session.id,
  device: session.deviceName ?? describeDevice(session.userAgent),
  ipAddress: formatSessionIp(session.ipAddress),
  lastSeenAt: session.lastSeenAt?.toISOString() ?? null,
  createdAt: session.createdAt.toISOString(),
  current: session.id === current.id || session.id === current.deviceSessionId,
});
