import { redirect } from "next/navigation";

import { EntryShell } from "@/components/public/entry-shell";
import { SetupExperience } from "@/components/public/setup-experience";
import { getCurrentSession } from "@/server/auth/session";
import { authService } from "@/server/auth/service";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  const [setupState, session] = await Promise.all([
    authService.getSetupState(),
    getCurrentSession(),
  ]);

  if (setupState.isBootstrapped) {
    redirect(session ? "/library" : "/sign-in");
  }

  return (
    <EntryShell
      scrimVariant="setup"
      contentClassName="justify-center"
      topNote="One-time bootstrap"
    >
      <SetupExperience
        title="Bring this Staaash instance online."
        description="Create the first owner account once. After that, this Staaash stays private and invite-only."
      />
    </EntryShell>
  );
}
