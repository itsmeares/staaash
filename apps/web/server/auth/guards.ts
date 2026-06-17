import { redirect } from "next/navigation";

import { canAccessAdminSurface } from "@/server/access";
import {
  getCurrentSession,
  getSessionTokenFromCookieStore,
} from "@/server/auth/session";
import { authService } from "@/server/auth/service";
import type { AuthSession } from "@/server/auth/types";

const hasCompletedOnboarding = (session: AuthSession | null) =>
  Boolean(
    session?.user.preferences?.onboardingCompletedAt &&
    !session.user.passwordChangeRequiredAt,
  );

export const requireSignedInPageSession = async (redirectTo = "/") => {
  const session = await getCurrentSession();

  if (!session) {
    redirect(redirectTo);
  }

  if (!hasCompletedOnboarding(session)) {
    redirect("/");
  }

  return session;
};

export const requireAdminPageSession = async () => {
  const session = await requireSignedInPageSession("/?next=/admin");

  if (!canAccessAdminSurface(session.user.role)) {
    redirect("/settings?error=admin");
  }

  return session;
};

export const requireOwnerPageSession = async () => {
  const session = await requireAdminPageSession();

  if (!session.user.isOwner) {
    redirect("/admin?error=owner");
  }

  return session;
};

export const getRequestSession = async (request: {
  cookies: { get(name: string): { value: string } | undefined };
}) => {
  const session = await authService.getSession(
    getSessionTokenFromCookieStore(request.cookies),
  );

  return hasCompletedOnboarding(session) ? session : null;
};
