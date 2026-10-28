import { authService } from "@/server/auth/service";
import type { AuthSession, UserPreferences } from "@/server/auth/types";

type OnboardedSession = AuthSession & {
  user: AuthSession["user"] & { preferences: UserPreferences };
};

const hasCompletedOnboarding = (
  session: AuthSession | null,
): session is OnboardedSession =>
  Boolean(
    session?.user.preferences?.onboardingCompletedAt &&
    !session.user.passwordChangeRequiredAt,
  );

/** The session for API calls: signed in, onboarded, and not owing a new password. */
export const getRequestSession = async (token: string | null) => {
  const session = await authService.getSession(token);

  return hasCompletedOnboarding(session) ? session : null;
};
