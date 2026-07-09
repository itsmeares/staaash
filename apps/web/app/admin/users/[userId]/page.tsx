import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import type { CSSProperties, ReactNode } from "react";
import { ArrowLeft } from "lucide-react";

import {
  formatAdminBytes,
  formatAdminDateTime,
  getAdminStatusClassName,
} from "@/app/admin/admin-format";
import { requireAdminPageSession } from "@/server/auth/guards";
import { authService } from "@/server/auth/service";
import { getAdminStorageSummary } from "@/server/admin/storage";
import { getBaseUrl } from "@/server/request";
import { getUserStorageUsed } from "@/server/user-storage";

import { AuthorizedDevicesPanel } from "./authorized-devices-panel";
import { UserDetailActions } from "./user-detail-actions";
import { UserDetailCopyButton } from "./user-detail-copy-button";

export const dynamic = "force-dynamic";

type AdminUserDetailsPageProps = {
  params: Promise<{
    userId: string;
  }>;
};

const roleLabel = (user: { isOwner: boolean; isAdmin: boolean }) =>
  user.isOwner ? "owner" : user.isAdmin ? "admin" : "member";

const parseDeviceLabel = (userAgent: string | null) => {
  if (!userAgent) return "Unknown device";

  const os = userAgent.includes("Windows")
    ? "Windows"
    : userAgent.includes("Mac OS")
      ? "macOS"
      : userAgent.includes("Linux")
        ? "Linux"
        : userAgent.includes("Android")
          ? "Android"
          : userAgent.includes("iPhone") || userAgent.includes("iPad")
            ? "iOS"
            : "Device";

  const browser = userAgent.includes("Firefox/")
    ? "Firefox"
    : userAgent.includes("Edg/")
      ? "Edge"
      : userAgent.includes("Chrome/")
        ? "Chrome"
        : userAgent.includes("Safari/")
          ? "Safari"
          : "Browser";

  return `${os} - ${browser}`;
};

const getQuotaPercent = (usedBytes: bigint, quotaBytes: bigint | null) => {
  if (!quotaBytes || quotaBytes <= 0n) return null;
  return Number((usedBytes * 1000n) / quotaBytes) / 10;
};

const formatPercent = (value: number) =>
  `${value.toFixed(value >= 100 || Number.isInteger(value) ? 0 : 1)}%`;

export default async function AdminUserDetailsPage({
  params,
}: AdminUserDetailsPageProps) {
  const [{ userId }, session, h] = await Promise.all([
    params,
    requireAdminPageSession(),
    headers(),
  ]);

  const [user, sessions, usage, storageSummary] = await Promise.all([
    authService.getUser(session.user.id, userId).catch((error) => {
      if (error?.code === "USER_NOT_FOUND") notFound();
      throw error;
    }),
    authService.listUserSessions(session.user.id, userId),
    getUserStorageUsed(userId),
    getAdminStorageSummary(),
  ]);
  const storageRow = storageSummary.rows.find((row) => row.userId === user.id);
  const signInUrl = new URL("/", getBaseUrl(h)).toString();
  const role = roleLabel(user);
  const initials =
    user.displayName?.slice(0, 1).toUpperCase() ??
    user.email.slice(0, 1).toUpperCase();
  const storageUsedLabel = formatAdminBytes(usage.usedBytes);
  const quotaPercent = getQuotaPercent(usage.usedBytes, user.storageLimitBytes);
  const quotaPercentLabel =
    quotaPercent === null ? null : formatPercent(quotaPercent);
  const quotaBarPercent =
    quotaPercent === null ? 0 : Math.max(0, Math.min(quotaPercent, 100));
  const mostRecentSession = sessions[0] ?? null;
  const lastSeenAt = mostRecentSession
    ? formatAdminDateTime(
        mostRecentSession.lastSeenAt ?? mostRecentSession.createdAt,
      )
    : "n/a";
  const hasStatusAlerts = Boolean(
    user.passwordChangeRequiredAt || !user.preferences?.onboardingCompletedAt,
  );

  return (
    <main className="admin-user-detail">
      <section className="admin-user-hero" aria-label="User profile summary">
        <div className="admin-user-hero-copy">
          <Link className="admin-user-back-button" href="/admin/users">
            <ArrowLeft size={15} aria-hidden />
            Back to users
          </Link>
          <div className="admin-user-hero-main">
            <span
              className="workspace-avatar admin-user-hero-avatar"
              aria-hidden
            >
              {user.avatarUrl ? (
                <img
                  src={user.avatarUrl}
                  alt=""
                  className="workspace-avatar-img"
                />
              ) : (
                <span className="workspace-avatar-initials">{initials}</span>
              )}
            </span>
            <div className="admin-user-identity">
              <h1>{user.displayName ?? "No name yet"}</h1>
              <p>{user.email}</p>
              {hasStatusAlerts ? (
                <div className="admin-user-status-row">
                  {user.passwordChangeRequiredAt ? (
                    <span className={getAdminStatusClassName("error")}>
                      password change required
                    </span>
                  ) : null}
                  {!user.preferences?.onboardingCompletedAt ? (
                    <span className={getAdminStatusClassName("warning")}>
                      onboarding incomplete
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        </div>
        <UserDetailActions
          user={{
            id: user.id,
            email: user.email,
            displayName: user.displayName,
            isOwner: user.isOwner,
            isAdmin: user.isAdmin,
            storageLimitBytes: user.storageLimitBytes?.toString() ?? null,
          }}
          canMutate={session.user.isOwner}
          signInUrl={signInUrl}
        />
      </section>

      <section className="admin-user-stat-grid" aria-label="User summary">
        <SummaryStat
          label="Total used"
          value={storageUsedLabel}
          detail={
            user.storageLimitBytes
              ? `${formatAdminBytes(user.storageLimitBytes)} quota`
              : "Unlimited quota"
          }
        />
        <SummaryStat
          label="Files"
          value={String(storageRow?.retainedFileCount ?? 0)}
          detail="stored files"
        />
        <SummaryStat
          label="Folders"
          value={String(storageRow?.retainedFolderCount ?? 0)}
          detail="stored folders"
        />
        <SummaryStat
          label="Active devices"
          value={String(sessions.length)}
          detail={`Last seen ${lastSeenAt}`}
        />
      </section>

      <div className="admin-user-detail-layout">
        <div className="admin-user-detail-main">
          <DetailPanel title="Account">
            <dl className="admin-user-fact-list">
              <FactRow label="Name" value={user.displayName ?? "No name yet"} />
              <FactRow
                label="Role"
                value={
                  <span className={getAdminStatusClassName(role)}>{role}</span>
                }
              />
              <FactRow
                label="Email"
                value={user.email}
                copyValue={user.email}
              />
              <FactRow
                label="Created"
                value={formatAdminDateTime(user.createdAt)}
              />
              <FactRow
                label="Updated"
                value={formatAdminDateTime(user.updatedAt)}
              />
              <FactRow
                label="User ID"
                value={user.id}
                copyValue={user.id}
                code
              />
              <FactRow
                label="Storage ID"
                value={user.storageId}
                copyValue={user.storageId}
                code
              />
            </dl>
          </DetailPanel>

          <DetailPanel title="Storage">
            <dl className="admin-user-fact-list">
              <FactRow
                label="Quota"
                value={
                  user.storageLimitBytes
                    ? formatAdminBytes(user.storageLimitBytes)
                    : "Unlimited"
                }
                detail={
                  quotaPercentLabel ? `${quotaPercentLabel} used` : undefined
                }
              />
              <FactRow
                label="Last content activity"
                value={formatAdminDateTime(
                  storageRow?.lastContentActivityAt ?? null,
                )}
              />
            </dl>
            {quotaPercentLabel ? (
              <div className="admin-user-quota-meter">
                <span
                  aria-hidden
                  style={
                    {
                      "--admin-user-quota": `${quotaBarPercent}%`,
                    } as CSSProperties
                  }
                />
                <p>{quotaPercentLabel} of quota used</p>
              </div>
            ) : null}
          </DetailPanel>
        </div>

        <aside className="admin-user-detail-side">
          <DetailPanel title="Security">
            <dl className="admin-user-fact-list">
              <FactRow label="Active devices" value={String(sessions.length)} />
              <FactRow label="Last seen" value={lastSeenAt} />
              <FactRow
                label="Password change"
                value={user.passwordChangeRequiredAt ? "Required" : "Clear"}
              />
              <FactRow
                label="Onboarding"
                value={
                  user.preferences?.onboardingCompletedAt
                    ? `Complete, ${formatAdminDateTime(
                        user.preferences.onboardingCompletedAt,
                      )}`
                    : "Incomplete"
                }
              />
            </dl>
          </DetailPanel>

          <AuthorizedDevicesPanel
            userId={user.id}
            sessions={sessions.map((deviceSession) => ({
              id: deviceSession.id,
              label: parseDeviceLabel(deviceSession.userAgent),
              ipAddress: deviceSession.ipAddress,
              lastSeenAt: deviceSession.lastSeenAt?.toISOString() ?? null,
              createdAt: deviceSession.createdAt.toISOString(),
              isCurrent: deviceSession.id === session.id,
            }))}
            canRevoke={session.user.isOwner}
          />
        </aside>
      </div>
    </main>
  );
}

function SummaryStat({
  detail,
  label,
  value,
}: {
  detail: string;
  label: string;
  value: string;
}) {
  return (
    <article className="admin-user-stat-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function DetailPanel({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) {
  return (
    <section className="admin-user-panel">
      <div className="admin-user-panel-head">
        <h2>{title}</h2>
      </div>
      {children}
    </section>
  );
}

function FactRow({
  copyValue,
  detail,
  label,
  value,
  code,
}: {
  copyValue?: string;
  detail?: string;
  label: string;
  value: ReactNode;
  code?: boolean;
}) {
  return (
    <div className="admin-user-fact-row">
      <dt>{label}</dt>
      <dd>
        <span className="admin-user-fact-value">
          {code && typeof value === "string" ? <code>{value}</code> : value}
        </span>
        {copyValue ? (
          <UserDetailCopyButton label={label} value={copyValue} />
        ) : null}
        {detail ? <small>{detail}</small> : null}
      </dd>
    </div>
  );
}
