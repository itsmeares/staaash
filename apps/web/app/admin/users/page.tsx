import { getSingleSearchParam } from "@/app/auth-ui";
import {
  PAGE_SIZE,
  PaginationControls,
  buildPageHref,
  parsePage,
} from "@/app/pagination-controls";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireOwnerPageSession } from "@/server/auth/guards";
import { getBaseUrl } from "@/server/request";
import { authService } from "@/server/auth/service";

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
    requireOwnerPageSession(),
    headers(),
  ]);
  const baseUrl = getBaseUrl(h);
  const allUsers = await authService.listUsers(session.user.id);
  const page = parsePage(getSingleSearchParam(resolvedSearchParams, "page"));
  const totalPages = Math.ceil(allUsers.length / PAGE_SIZE);
  const buildHref = buildPageHref("/admin/users");

  if (totalPages > 0 && page > totalPages) redirect(buildHref(1));

  const users = allUsers.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <main className="stack" style={{ gap: "40px" }}>
      <section>
        <h1 style={{ marginBottom: "8px" }}>User management</h1>
        <p className="muted" style={{ maxWidth: "56ch" }}>
          Inventory and password reset issuance. Role changes and moderation
          controls are out of scope for this release.
        </p>
      </section>

      <UsersAdminConsole
        appUrl={baseUrl}
        initialUsers={users.map((user) => ({
          id: user.id,
          email: user.email,
          username: user.username,
          displayName: user.displayName,
          role: user.role,
          createdAt: user.createdAt.toISOString(),
          storageLimitBytes: user.storageLimitBytes?.toString() ?? null,
        }))}
      />

      <PaginationControls
        buildHref={buildHref}
        page={page}
        totalPages={totalPages}
      />
    </main>
  );
}
