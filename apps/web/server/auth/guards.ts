import { redirect } from "next/navigation";

import { canAccessAdminSurface } from "@/server/access";
import {
  getCurrentSession,
  getSessionTokenFromCookieStore,
} from "@/server/auth/session";
import { authService } from "@/server/auth/service";

export const requireSignedInPageSession = async (redirectTo = "/sign-in") => {
  const session = await getCurrentSession();

  if (!session) {
    redirect(redirectTo);
  }

  return session;
};

export const requireOwnerPageSession = async () => {
  const session = await requireSignedInPageSession("/sign-in?next=/admin");

  if (!canAccessAdminSurface(session.user.role)) {
    redirect("/settings?error=admin");
  }

  return session;
};

export const getRequestSession = async (request: {
  cookies: { get(name: string): { value: string } | undefined };
}) => authService.getSession(getSessionTokenFromCookieStore(request.cookies));
