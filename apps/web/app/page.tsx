import { redirect } from "next/navigation";

import { EntryRoot } from "@/components/public/entry-root";
import { authService } from "@/server/auth/service";
import { getCurrentSession } from "@/server/auth/session";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const [setupState, session] = await Promise.all([
    authService.getSetupState(),
    getCurrentSession(),
  ]);

  if (session) {
    redirect("/library");
  }

  return (
    <EntryRoot
      mode={setupState.isBootstrapped ? "signin" : "setup"}
      instanceName={setupState.instanceName ?? undefined}
    />
  );
}
