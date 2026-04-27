import React from "react";
import { redirect } from "next/navigation";

import { getSafeLocalPath, getSingleSearchParam } from "@/app/auth-ui";
import { EntryRoot } from "@/components/public/entry-root";
import { authService } from "@/server/auth/service";
import { getCurrentSession } from "@/server/auth/session";

export const dynamic = "force-dynamic";

type HomePageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function HomePage({ searchParams }: HomePageProps) {
  const [resolvedSearchParams, setupState, session] = await Promise.all([
    searchParams,
    authService.getSetupState(),
    getCurrentSession(),
  ]);

  const next = getSafeLocalPath(
    getSingleSearchParam(resolvedSearchParams, "next"),
    "/files",
  );

  if (session) {
    if (session.user.preferences?.onboardingCompletedAt) {
      redirect("/files");
    }
    return (
      <EntryRoot
        mode="onboarding"
        instanceName={setupState.instanceName ?? undefined}
        isOwner={session.user.role === "owner"}
      />
    );
  }

  return (
    <EntryRoot
      mode={setupState.isBootstrapped ? "signin" : "setup"}
      instanceName={setupState.instanceName ?? undefined}
      next={next}
    />
  );
}
