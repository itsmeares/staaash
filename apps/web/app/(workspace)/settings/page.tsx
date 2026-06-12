import {
  FlashMessage,
  formatDateTime,
  getSingleSearchParam,
} from "@/app/auth-ui";
import { DEFAULT_TIME_ZONE } from "@staaash/config/time-zone";
import { requireSignedInPageSession } from "@/server/auth/guards";
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
    error === "admin"
      ? "Admin access is restricted to the instance owner."
      : error;

  const prefs = session.user.preferences;

  return (
    <div className="workspace-page settings-page">
      <section className="settings-page-head">
        <h1>Settings</h1>
      </section>

      {errorMessage ? <FlashMessage>{errorMessage}</FlashMessage> : null}
      {success ? <FlashMessage tone="success">{success}</FlashMessage> : null}

      <div className="settings-accordion" aria-label="Settings sections">
        <details className="settings-panel">
          <summary className="settings-panel-summary">
            <span>
              <span className="settings-panel-title">Preferences</span>
              <span className="settings-panel-description">
                Theme, time zone, and update notices
              </span>
            </span>
          </summary>
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
        </details>

        <details className="settings-panel">
          <summary className="settings-panel-summary">
            <span>
              <span className="settings-panel-title">Account</span>
              <span className="settings-panel-description">
                Identity and access role
              </span>
            </span>
          </summary>
          <div className="settings-panel-body">
            <dl className="settings-list">
              <div className="settings-row">
                <dt className="settings-row-label">Display name</dt>
                <dd className="settings-row-value">
                  {session.user.displayName ?? "Not set"}
                </dd>
              </div>
              <div className="settings-row">
                <dt className="settings-row-label">Email</dt>
                <dd className="settings-row-value">{session.user.email}</dd>
              </div>
              <div className="settings-row">
                <dt className="settings-row-label">Username</dt>
                <dd className="settings-row-value">@{session.user.username}</dd>
              </div>
              <div className="settings-row">
                <dt className="settings-row-label">Role</dt>
                <dd className="settings-row-value">{session.user.role}</dd>
              </div>
            </dl>
          </div>
        </details>

        <details className="settings-panel">
          <summary className="settings-panel-summary">
            <span>
              <span className="settings-panel-title">Session</span>
              <span className="settings-panel-description">
                Current browser session
              </span>
            </span>
          </summary>
          <div className="settings-panel-body">
            <dl className="settings-list">
              <div className="settings-row">
                <dt className="settings-row-label">Session ID</dt>
                <dd className="settings-row-value">
                  <code>{session.id}</code>
                </dd>
              </div>
              <div className="settings-row">
                <dt className="settings-row-label">Created</dt>
                <dd className="settings-row-value">
                  {formatDateTime(session.createdAt, prefs?.timeZone)}
                </dd>
              </div>
              <div className="settings-row">
                <dt className="settings-row-label">Expires</dt>
                <dd className="settings-row-value">
                  {formatDateTime(session.expiresAt, prefs?.timeZone)}
                </dd>
              </div>
              <div className="settings-row settings-row-action">
                <dt className="settings-row-label">Sign out</dt>
                <dd className="settings-row-value">
                  <form action="/api/auth/sign-out" method="post">
                    <input type="hidden" name="next" value="/" />
                    <button
                      className="settings-action settings-action-danger"
                      type="submit"
                    >
                      Sign out
                    </button>
                  </form>
                </dd>
              </div>
            </dl>
          </div>
        </details>
      </div>
    </div>
  );
}
