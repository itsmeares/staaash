import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

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
import { headers } from "next/headers";

import { AuthorizedDevicesPanel } from "./authorized-devices-panel";
import { UserDetailActions } from "./user-detail-actions";

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

  return `${os} · ${browser}`;
};

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

  return (
    <main className="stack admin-user-detail">
      <section className="admin-user-detail-head">
        <div className="stack" style={{ gap: "10px" }}>
          <Link className="admin-kv-link" href="/admin/users">
            User management
          </Link>
          <div className="cluster">
            <span className="workspace-avatar" aria-hidden>
              {user.displayName?.slice(0, 1).toUpperCase() ??
                user.email.slice(0, 1).toUpperCase()}
            </span>
            <div>
              <h1>{user.displayName ?? "No name yet"}</h1>
              <div className="cluster" style={{ gap: "6px", marginTop: "8px" }}>
                <span className={getAdminStatusClassName(role)}>{role}</span>
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

      <dl className="admin-kv-strip">
        <div className="admin-kv-item">
          <dt className="admin-kv-label">Files</dt>
          <dd className="admin-kv-value">
            {storageRow?.retainedFileCount ?? 0}
          </dd>
        </div>
        <div className="admin-kv-item">
          <dt className="admin-kv-label">Folders</dt>
          <dd className="admin-kv-value">
            {storageRow?.retainedFolderCount ?? 0}
          </dd>
        </div>
        <div className="admin-kv-item">
          <dt className="admin-kv-label">Storage used</dt>
          <dd className="admin-kv-value">
            {formatAdminBytes(usage.usedBytes)}
          </dd>
          <dd className="admin-kv-sub">
            {user.storageLimitBytes
              ? `${formatAdminBytes(user.storageLimitBytes)} quota`
              : "Unlimited quota"}
          </dd>
        </div>
      </dl>

      <section className="admin-user-detail-sheet">
        <DetailSection title="Profile">
          <dl className="meta-list">
            <MetaRow label="Name" value={user.displayName ?? "No name yet"} />
            <MetaRow label="Email" value={user.email} />
            <MetaRow
              label="Created"
              value={formatAdminDateTime(user.createdAt)}
            />
            <MetaRow
              label="Updated"
              value={formatAdminDateTime(user.updatedAt)}
            />
            <MetaRow label="User ID" value={user.id} code />
            <MetaRow label="Storage ID" value={user.storageId} code />
          </dl>
        </DetailSection>

        <DetailSection title="Access">
          <dl className="meta-list">
            <MetaRow label="Owner" value={user.isOwner ? "Yes" : "No"} />
            <MetaRow label="Admin" value={user.isAdmin ? "Yes" : "No"} />
            <MetaRow
              label="Password change"
              value={
                user.passwordChangeRequiredAt
                  ? formatAdminDateTime(user.passwordChangeRequiredAt)
                  : "Not required"
              }
            />
            <MetaRow
              label="Onboarding"
              value={
                user.preferences?.onboardingCompletedAt
                  ? formatAdminDateTime(user.preferences.onboardingCompletedAt)
                  : "Incomplete"
              }
            />
          </dl>
        </DetailSection>

        <DetailSection title="Storage quota">
          <dl className="meta-list">
            <MetaRow
              label="Quota"
              value={
                user.storageLimitBytes
                  ? formatAdminBytes(user.storageLimitBytes)
                  : "Unlimited"
              }
            />
            <MetaRow label="Used" value={formatAdminBytes(usage.usedBytes)} />
          </dl>
        </DetailSection>

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
      </section>
    </main>
  );
}

function DetailSection({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) {
  return (
    <section className="admin-user-detail-section">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function MetaRow({
  label,
  value,
  code,
}: {
  label: string;
  value: string;
  code?: boolean;
}) {
  return (
    <div className="meta-row">
      <dt>{label}</dt>
      <dd>{code ? <code>{value}</code> : value}</dd>
    </div>
  );
}
