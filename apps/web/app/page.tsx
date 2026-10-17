import React from "react";
import { redirect } from "next/navigation";

import { getSafeLocalPath, getSingleSearchParam } from "@/app/auth-ui";
import { SignIn } from "@/components/public/entry-experience";
import { FirstRun, type FirstRunKind } from "@/components/public/first-run";
import { authService } from "@/server/auth/service";
import { getCurrentSession } from "@/server/auth/session";
import { getSystemSettings } from "@/server/settings";

export const dynamic = "force-dynamic";

type HomePageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** Which first-run steps a signed-in person still needs, if any. */
const firstRunKind = (user: {
  isOwner: boolean;
  passwordChangeRequiredAt: Date | null;
  preferences: { onboardingCompletedAt: Date | null } | null;
}): FirstRunKind | null => {
  const onboarded = Boolean(user.preferences?.onboardingCompletedAt);
  if (onboarded) return user.passwordChangeRequiredAt ? "password" : null;
  if (user.isOwner) return "owner";
  return user.passwordChangeRequiredAt ? "member-password" : "member";
};

export default async function HomePage({ searchParams }: HomePageProps) {
  const [resolvedSearchParams, setupState, session, systemSettings] =
    await Promise.all([
      searchParams,
      authService.getSetupState(),
      getCurrentSession(),
      getSystemSettings(),
    ]);
  // Without ?next, sign-in goes to the person's start page.
  const rawNext = getSingleSearchParam(resolvedSearchParams, "next");
  const next = rawNext ? getSafeLocalPath(rawNext, "/files") : undefined;
  const instanceName = setupState.instanceName?.trim() || "Staaash";

  if (session) {
    const kind = firstRunKind(session.user);
    if (!kind) redirect("/api/auth/rehydrate");
    return (
      <FirstRun
        displayName={session.user.displayName}
        initialPreviews={{
          enabled: systemSettings.mediaPreviewEnabled,
          onUpload: systemSettings.mediaPreviewGenerateOnUpload,
          onFirstView: systemSettings.mediaPreviewGenerateOnFirstView,
          onShare: systemSettings.mediaPreviewGenerateOnShare,
        }}
        instanceName={instanceName}
        kind={kind}
      />
    );
  }

  if (!setupState.isBootstrapped) {
    return <FirstRun instanceName={instanceName} kind="owner-setup" />;
  }

  return <SignIn instanceName={instanceName} next={next} />;
}
