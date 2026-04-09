import { env } from "@/lib/env";
import { requireOwnerPageSession } from "@/server/auth/guards";
import { authService } from "@/server/auth/service";

import { UsersAdminConsole } from "../users-admin-console";

export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
  const session = await requireOwnerPageSession();
  const users = await authService.listUsers(session.user.id);

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
        }))}
      />
    </main>
  );
}
