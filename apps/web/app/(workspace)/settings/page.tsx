import {
  FlashMessage,
  formatDateTime,
  getSingleSearchParam,
} from "@/app/auth-ui";
import { DEFAULT_TIME_ZONE } from "@staaash/config/time-zone";
import { PageHeader } from "@/components/page-header";
import {
  SettingsAccordion,
  SettingsList,
  SettingsPanel,
  SettingsRow,
} from "@/components/settings-panel";
import { Button } from "@/components/ui/button";
import { requireSignedInPageSession } from "@/server/auth/guards";
import { WorkspacePage } from "../workspace-page";
import { PreferencesForm } from "./preferences-form";

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
    <WorkspacePage className="mx-auto w-full max-w-settings content-start gap-4.5">
      <PageHeader title="Settings" />

      {errorMessage ? <FlashMessage>{errorMessage}</FlashMessage> : null}
      {success ? <FlashMessage tone="success">{success}</FlashMessage> : null}

      <SettingsAccordion>
        <SettingsPanel
          title="Preferences"
          description="Theme, time zone, and update notices"
        >
          <PreferencesForm
            initialTheme={
              (prefs?.theme as "light" | "dark" | "system") ?? "system"
            }
            initialTimeZone={prefs?.timeZone ?? DEFAULT_TIME_ZONE}
            initialShowUpdateNotifications={
              prefs?.showUpdateNotifications ?? true
            }
            initialEnableVersionChecks={prefs?.enableVersionChecks ?? true}
          />
        </SettingsPanel>

        <SettingsPanel title="Account" description="Identity and access">
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

        <SettingsPanel title="Session" description="Current browser session">
          <SettingsList>
            <SettingsRow kind="value" label="Session ID">
              <code>{session.id}</code>
            </SettingsRow>
            <SettingsRow kind="value" label="Created">
              {formatDateTime(session.createdAt, prefs?.timeZone)}
            </SettingsRow>
            <SettingsRow kind="value" label="Expires">
              {formatDateTime(session.expiresAt, prefs?.timeZone)}
            </SettingsRow>
            <SettingsRow kind="value" label="Sign out">
              <form action="/api/auth/sign-out" method="post">
                <input type="hidden" name="next" value="/" />
                <Button type="submit" variant="destructive-outline">
                  Sign out
                </Button>
              </form>
            </SettingsRow>
          </SettingsList>
        </SettingsPanel>
      </SettingsAccordion>
    </WorkspacePage>
  );
}
