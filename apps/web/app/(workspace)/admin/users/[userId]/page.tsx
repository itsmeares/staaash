import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";

import { AdminAvatar } from "@/app/(workspace)/admin/admin-avatar";
import {
  formatAdminBytes,
  formatAdminDateTime,
} from "@/app/(workspace)/admin/admin-format";
import { AdminPanel } from "@/app/(workspace)/admin/admin-panel";
import { AdminStatCard } from "@/app/(workspace)/admin/admin-stat-card";
import { AdminStatusBadge } from "@/app/(workspace)/admin/admin-status-badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { requireAdminPageSession } from "@/server/auth/guards";
import { authService } from "@/server/auth/service";
import { getAdminStorageSummary } from "@/server/admin/storage";
import { getBaseUrl } from "@/server/request";
import { getUserStorageUsed } from "@/server/user-storage";
import { resolveDisplayTimeZone } from "@/server/time-zone";

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
  const { timeZone } = await resolveDisplayTimeZone(session.user);

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
        timeZone,
      )
    : "n/a";
  const hasStatusAlerts = Boolean(
    user.passwordChangeRequiredAt || !user.preferences?.onboardingCompletedAt,
  );

  return (
    <main className="m-0 mx-auto grid w-[min(1420px,100%)] grid-cols-1 gap-4.5 p-0">
      <section
        className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-5 rounded-lg border border-hairline bg-card p-5 max-md:grid-cols-1 max-xs:p-4"
        aria-label="User profile summary"
      >
        <div className="grid min-w-0 grid-cols-1 gap-3.5">
          <Button
            className="justify-self-start"
            variant="outline"
            size="sm"
            render={<Link href="/admin/users" />}
          >
            <ArrowLeft aria-hidden />
            Back to users
          </Button>
          <div className="flex min-w-0 items-center gap-4 max-xs:items-start">
            <AdminAvatar
              avatarUrl={user.avatarUrl ?? null}
              initials={initials}
              size="xl"
            />
            <div className="grid min-w-0 grid-cols-1 gap-1.5">
              <h1 className="m-0 truncate font-sans text-3xl leading-tight font-bold text-foreground max-xs:whitespace-normal">
                {user.displayName ?? "No name yet"}
              </h1>
              <p className="m-0 truncate text-body text-muted-foreground max-xs:whitespace-normal">
                {user.email}
              </p>
              {hasStatusAlerts ? (
                <div className="flex flex-wrap items-center gap-2">
                  {user.passwordChangeRequiredAt ? (
                    <AdminStatusBadge status="error" size="lg">
                      Password change required
                    </AdminStatusBadge>
                  ) : null}
                  {!user.preferences?.onboardingCompletedAt ? (
                    <AdminStatusBadge status="warning" size="lg">
                      Onboarding incomplete
                    </AdminStatusBadge>
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

      <section
        className="grid grid-cols-4 gap-3.5 max-md:grid-cols-2 max-xs:grid-cols-1"
        aria-label="User summary"
      >
        <AdminStatCard
          label="Total used"
          value={storageUsedLabel}
          detail={
            user.storageLimitBytes
              ? `${formatAdminBytes(user.storageLimitBytes)} quota`
              : "Unlimited quota"
          }
        />
        <AdminStatCard
          label="Files"
          value={String(storageRow?.retainedFileCount ?? 0)}
          detail="stored files"
        />
        <AdminStatCard
          label="Folders"
          value={String(storageRow?.retainedFolderCount ?? 0)}
          detail="stored folders"
        />
        <AdminStatCard
          label="Active devices"
          value={String(sessions.length)}
          detail={`Last seen ${lastSeenAt}`}
        />
      </section>

      <div className="grid grid-cols-[minmax(0,1fr)_minmax(320px,0.38fr)] items-start gap-4.5 max-md:grid-cols-1">
        <div className="grid min-w-0 grid-cols-1 gap-4.5">
          <AdminPanel title="Account">
            <dl className="m-0 grid grid-cols-1 gap-0">
              <FactRow label="Name" value={user.displayName ?? "No name yet"} />
              <FactRow
                label="Role"
                value={<AdminStatusBadge status={role} />}
              />
              <FactRow
                label="Email"
                value={user.email}
                copyValue={user.email}
              />
              <FactRow
                label="Created"
                value={formatAdminDateTime(user.createdAt, timeZone)}
              />
              <FactRow
                label="Updated"
                value={formatAdminDateTime(user.updatedAt, timeZone)}
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
          </AdminPanel>

          <AdminPanel title="Storage">
            <dl className="m-0 grid grid-cols-1 gap-0">
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
                  timeZone,
                )}
              />
            </dl>
            {quotaPercentLabel ? (
              <div className="grid grid-cols-1 gap-2 pt-0.5">
                <Progress aria-label="Quota used" value={quotaBarPercent} />
                <p className="m-0 text-label text-muted-foreground">
                  {quotaPercentLabel} of quota used
                </p>
              </div>
            ) : null}
          </AdminPanel>
        </div>

        <aside className="grid min-w-0 grid-cols-1 gap-4.5">
          <AdminPanel title="Security">
            <dl className="m-0 grid grid-cols-1 gap-0">
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
                    ? `Complete, ${formatAdminDateTime(user.preferences.onboardingCompletedAt, timeZone)}`
                    : "Incomplete"
                }
              />
            </dl>
          </AdminPanel>

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
    <div className="grid grid-cols-[minmax(145px,0.3fr)_minmax(0,1fr)] items-start gap-4 border-b border-hairline py-3 last:border-b-0 max-md:grid-cols-1 max-md:gap-1.5">
      <dt className="text-label font-medium text-muted-foreground">{label}</dt>
      <dd className="m-0 flex min-w-0 flex-wrap items-center gap-2 text-meta text-foreground">
        <span className="min-w-0 font-semibold wrap-anywhere [&_code]:whitespace-normal">
          {code && typeof value === "string" ? <code>{value}</code> : value}
        </span>
        {copyValue ? (
          <UserDetailCopyButton label={label} value={copyValue} />
        ) : null}
        {detail ? (
          <small className="basis-full text-label text-muted-foreground">
            {detail}
          </small>
        ) : null}
      </dd>
    </div>
  );
}
