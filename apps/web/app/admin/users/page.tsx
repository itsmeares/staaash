import { getSingleSearchParam } from "@/app/auth-ui";
import {
  PAGE_SIZE,
  PaginationControls,
  parsePage,
} from "@/app/pagination-controls";
import { env } from "@/lib/env";
import { requireOwnerPageSession } from "@/server/auth/guards";
import { authService } from "@/server/auth/service";

import { UsersAdminConsole } from "../users-admin-console";

export const dynamic = "force-dynamic";

type AdminUsersPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AdminUsersPage({
  searchParams,
}: AdminUsersPageProps) {
  const [resolvedSearchParams, session] = await Promise.all([
    searchParams,
    requireOwnerPageSession(),
  ]);
  const allUsers = await authService.listUsers(session.user.id);
  const page = parsePage(getSingleSearchParam(resolvedSearchParams, "page"));
  const totalPages = Math.ceil(allUsers.length / PAGE_SIZE);
  const users = allUsers.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const buildHref = (p: number) =>
    p === 1 ? "/admin/users" : `/admin/users?page=${p}`;

  return (
    <main className="stack">
      <section className="panel stack">
        <div className="pill admin-pill">/admin/users</div>
        <h1>User management</h1>
        <p className="muted">
          Phase 7 keeps user management operational: inventory and password
          reset issuance, without role changes or moderation controls.
        </p>
      </section>

      <UsersAdminConsole
        appUrl={env.APP_URL}
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
