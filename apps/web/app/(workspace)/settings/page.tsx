import { AUTO_TIME_ZONE } from "@staaash/config/time-zone";

import { FlashMessage } from "@/app/auth-ui";

import { PageHeader } from "@/components/page-header";
import { DateTime } from "@/components/time-provider";
import { requireSignedInPageSession } from "@/server/auth/guards";

import { WorkspacePage } from "../workspace-page";
import { PersonalSettings } from "./preferences-form";

export const dynamic = "force-dynamic";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const [{ error }, session] = await Promise.all([
    searchParams,
    requireSignedInPageSession("/?next=/settings"),
  ]);
  const prefs = session.user.preferences;

  return (
    <WorkspacePage className="w-full content-start gap-6">
      <PageHeader title="Settings" />
      {error === "admin" ? (
        <FlashMessage>Only owners can open the admin pages.</FlashMessage>
      ) : null}
      <PersonalSettings
        email={session.user.email}
        initialShowUpdates={prefs?.showUpdateNotifications ?? true}
        initialTheme={(prefs?.theme as "light" | "dark" | "system") ?? "system"}
        initialTimeZone={prefs?.timeZone ?? AUTO_TIME_ZONE}
        isOwner={session.user.isAdmin}
        name={session.user.displayName}
        role={
          session.user.isOwner
            ? "Owner"
            : session.user.isAdmin
              ? "Admin"
              : "Member"
        }
        session={{
          signedIn: <DateTime value={session.createdAt} />,
          expires: <DateTime value={session.expiresAt} />,
        }}
      />
    </WorkspacePage>
  );
}
