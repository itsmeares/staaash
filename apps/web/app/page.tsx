import React from "react";
import { redirect } from "next/navigation";

import { getSafeLocalPath, getSingleSearchParam } from "@/app/auth-ui";
import { EntryRoot } from "@/components/public/entry-root";
import { resolveAppVersion } from "@/server/app-version";
import { authService } from "@/server/auth/service";
import { getCurrentSession } from "@/server/auth/session";
import { getSystemSettings } from "@/server/settings";

export const dynamic = "force-dynamic";

type HomePageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function HomePage({ searchParams }: HomePageProps) {
  const [resolvedSearchParams, setupState, session, systemSettings] =
    await Promise.all([
      searchParams,
      authService.getSetupState(),
      getCurrentSession(),
      getSystemSettings(),
    ]);

  const appVersion = resolveAppVersion();
  const next = getSafeLocalPath(
    getSingleSearchParam(resolvedSearchParams, "next"),
    "/files",
  );

  if (session) {
    if (session.user.passwordChangeRequiredAt) {
      return (
        <EntryRoot
          appVersion={appVersion}
          mode="password-change"
          instanceName={setupState.instanceName ?? undefined}
        />
      );
    }

    if (session.user.preferences?.onboardingCompletedAt) {
      redirect("/api/auth/rehydrate");
    }
    return (
      <EntryRoot
        appVersion={appVersion}
        mode="onboarding"
        instanceName={setupState.instanceName ?? undefined}
        isOwner={session.user.isOwner}
        initialMediaPreviewEnabled={systemSettings.mediaPreviewEnabled}
        initialMediaPreviewGenerateOnUpload={
          systemSettings.mediaPreviewGenerateOnUpload
        }
        initialMediaPreviewGenerateOnFirstView={
          systemSettings.mediaPreviewGenerateOnFirstView
        }
        initialMediaPreviewGenerateOnShare={
          systemSettings.mediaPreviewGenerateOnShare
        }
      />
    );
  }

  return (
    <EntryRoot
      appVersion={appVersion}
      mode={setupState.isBootstrapped ? "signin" : "setup"}
      instanceName={setupState.instanceName ?? undefined}
      next={next}
    />
  );
}
