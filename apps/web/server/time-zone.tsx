import { cookies } from "next/headers";

import {
  TIME_ZONE_COOKIE_NAME,
  isValidTimeZone,
  normalizeTimeZone,
} from "@staaash/config/time-zone";

import { TimeProvider } from "@/components/time-provider";
import type { AuthUser } from "@/server/auth/types";
import { getSystemSettings } from "@/server/settings";

// Zone used to render dates for this request: a fixed user preference wins,
// then the browser zone remembered in a cookie, then the instance zone.
// `autoDetect` tells the client to correct it from the browser after mount.
export const resolveDisplayTimeZone = async (
  user: Pick<AuthUser, "preferences"> | null | undefined,
) => {
  // AUTO_TIME_ZONE is not a valid IANA zone, so it falls through.
  const preference = user?.preferences?.timeZone ?? "";
  if (isValidTimeZone(preference)) {
    return { timeZone: preference, autoDetect: false };
  }

  const cookieZone = (await cookies()).get(TIME_ZONE_COOKIE_NAME)?.value ?? "";
  if (isValidTimeZone(cookieZone)) {
    return { timeZone: cookieZone, autoDetect: true };
  }

  const settings = await getSystemSettings();
  return { timeZone: normalizeTimeZone(settings.timeZone), autoDetect: true };
};

export async function TimeRoot({
  children,
  user,
}: {
  children: React.ReactNode;
  user: Pick<AuthUser, "preferences"> | null | undefined;
}) {
  const { timeZone, autoDetect } = await resolveDisplayTimeZone(user);
  return (
    <TimeProvider
      autoDetect={autoDetect}
      serverNow={Date.now()}
      timeZone={timeZone}
    >
      {children}
    </TimeProvider>
  );
}
