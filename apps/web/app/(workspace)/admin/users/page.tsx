import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { getSingleSearchParam } from "@/app/auth-ui";
import {
  PAGE_SIZE,
  PaginationControls,
  buildPageHref,
  parsePage,
} from "@/app/pagination-controls";
import { requireAdminPageSession } from "@/server/auth/guards";
import { authService } from "@/server/auth/service";
import { accountNote } from "@/lib/user";
import { getBaseUrl } from "@/server/request";
import { getUserStorageUsed } from "@/server/user-storage";

import { UsersAdminConsole } from "../users-admin-console";

export const dynamic = "force-dynamic";

type AdminUsersPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AdminUsersPage({
  searchParams,
}: AdminUsersPageProps) {
  const [resolvedSearchParams, session, h] = await Promise.all([
    searchParams,
    requireAdminPageSession(),
    headers(),
  ]);
  const baseUrl = getBaseUrl(h);
  const allUsers = await authService.listUsers(session.user.id);
  const page = parsePage(getSingleSearchParam(resolvedSearchParams, "page"));
  const totalPages = Math.ceil(allUsers.length / PAGE_SIZE);
  const buildHref = buildPageHref("/admin/users");

  if (totalPages > 0 && page > totalPages) redirect(buildHref(1));

  const users = allUsers.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const usageByUserId = new Map(
    await Promise.all(
      users.map(async (user) => {
        const usage = await getUserStorageUsed(user.id);
        return [user.id, usage.usedBytes] as const;
      }),
    ),
  );

  return (
    <main className="m-0 grid w-full gap-4 p-0">
      <UsersAdminConsole
        canInvite={session.user.isOwner}
        signInUrl={new URL("/", baseUrl).toString()}
        users={users.map((user) => ({
          id: user.id,
          email: user.email,
          displayName: user.displayName,
          avatarUrl: user.avatarUrl,
          role: user.role,
          storageLimitBytes: user.storageLimitBytes?.toString() ?? null,
          storageUsedBytes: (usageByUserId.get(user.id) ?? 0n).toString(),
          note: accountNote(user),
        }))}
      />

      {totalPages > 1 ? (
        <div className="flex max-w-4xl justify-end">
          <PaginationControls
            buildHref={buildHref}
            page={page}
            totalPages={totalPages}
          />
        </div>
      ) : null}
    </main>
  );
}
