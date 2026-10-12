import { FlashMessage } from "@/app/auth-ui";
import { PageHeader } from "@/components/page-header";
import type { Theme } from "@/lib/theme";
import { roleLabel } from "@/lib/user";
import { toDevice } from "@/lib/user-agent";
import { requireSignedInPageSession } from "@/server/auth/guards";
import { authService } from "@/server/auth/service";
import { getStorageBreakdown } from "@/server/user-storage";

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
  const [storage, sessions] = await Promise.all([
    getStorageBreakdown(session.user.id),
    authService.listOwnSessions(session.user.id),
  ]);

  return (
    <WorkspacePage className="w-full content-start gap-6">
      <PageHeader title="Settings" />
      {error === "admin" ? (
        <FlashMessage>Only owners can open the admin pages.</FlashMessage>
      ) : null}
      <PersonalSettings
        isOwner={session.user.isAdmin}
        prefs={{
          theme: prefs.theme as Theme,
          timeZone: prefs.timeZone,
          showUpdateNotifications: prefs.showUpdateNotifications,
          showFolderPreviews: prefs.showFolderPreviews,
          startPage: prefs.startPage as "home" | "files",
          defaultView: prefs.defaultView as "list" | "grid",
          clockFormat: prefs.clockFormat as "12h" | "24h",
        }}
        sessions={sessions
          .map((entry) => toDevice(entry, session.id))
          .sort((a, b) => Number(b.current) - Number(a.current))}
        storage={storage}
        profile={{
          name: session.user.displayName,
          email: session.user.email,
          avatarUrl: session.user.avatarUrl,
          role: roleLabel(session.user.role),
        }}
      />
    </WorkspacePage>
  );
}
