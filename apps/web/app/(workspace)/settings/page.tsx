import { FlashMessage, getSingleSearchParam } from "@/app/auth-ui";
import { AUTO_TIME_ZONE } from "@staaash/config/time-zone";
import { PageHeader } from "@/components/page-header";
import { DateTime } from "@/components/time-provider";
import {
  SettingsAccordion,
  SettingsList,
  SettingsPanel,
  SettingsRow,
} from "@/components/settings-panel";
import { Button } from "@/components/ui/button";
import { requireSignedInPageSession } from "@/server/auth/guards";
import { WorkspacePage } from "../workspace-page";
import {
  AppearanceSettings,
  RegionSettings,
  UpdateSettings,
} from "./preferences-form";

export const dynamic = "force-dynamic";

type SettingsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function SettingsPage({
  searchParams,
}: SettingsPageProps) {
  const [resolvedSearchParams, session] = await Promise.all([
    searchParams,
    requireSignedInPageSession("/?next=/settings"),
  ]);
  const error = getSingleSearchParam(resolvedSearchParams, "error");
  const success = getSingleSearchParam(resolvedSearchParams, "success");
  const errorMessage =
    error === "admin" ? "Admin access is restricted to admins." : error;
  const prefs = session.user.preferences;

  return (
    <WorkspacePage className="w-full max-w-settings content-start gap-6">
      <PageHeader title="Settings" />

      {errorMessage ? <FlashMessage>{errorMessage}</FlashMessage> : null}
      {success ? <FlashMessage tone="success">{success}</FlashMessage> : null}

      <SettingsAccordion>
        <SettingsPanel id="appearance" title="Appearance">
          <AppearanceSettings
            initialTheme={
              (prefs?.theme as "light" | "dark" | "system") ?? "system"
            }
          />
        </SettingsPanel>

        <SettingsPanel id="region" title="Region">
          <RegionSettings initialTimeZone={prefs?.timeZone ?? AUTO_TIME_ZONE} />
        </SettingsPanel>

        {/* Update news is for owners; members see the version in About. */}
        {session.user.isAdmin ? (
          <SettingsPanel id="updates" title="Updates">
            <UpdateSettings
              initialShow={prefs?.showUpdateNotifications ?? true}
            />
          </SettingsPanel>
        ) : null}

        <SettingsPanel id="account" title="Account">
          <SettingsList>
            <SettingsRow kind="value" label="Display name">
              {session.user.displayName ?? "Not set"}
            </SettingsRow>
            <SettingsRow kind="value" label="Email">
              {session.user.email}
            </SettingsRow>
            <SettingsRow kind="value" label="Access">
              {session.user.isOwner
                ? "Owner"
                : session.user.isAdmin
                  ? "Admin"
                  : "Member"}
            </SettingsRow>
          </SettingsList>
        </SettingsPanel>

        <SettingsPanel id="session" title="This session">
          <SettingsList>
            <SettingsRow kind="value" label="Signed in">
              <DateTime value={session.createdAt} />
            </SettingsRow>
            <SettingsRow kind="value" label="Expires">
              <DateTime value={session.expiresAt} />
            </SettingsRow>
            <SettingsRow kind="value" label="Session ID">
              <code className="text-meta">{session.id.slice(0, 12)}…</code>
            </SettingsRow>
          </SettingsList>
          <form action="/api/auth/sign-out" method="post">
            <input type="hidden" name="next" value="/" />
            <Button type="submit" variant="destructive-outline">
              Sign out
            </Button>
          </form>
        </SettingsPanel>
      </SettingsAccordion>
    </WorkspacePage>
  );
}
