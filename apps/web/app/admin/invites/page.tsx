import { env } from "@/lib/env";
import { requireOwnerPageSession } from "@/server/auth/guards";
import { authService } from "@/server/auth/service";

import { InvitesAdminConsole } from "../invites-admin-console";

export const dynamic = "force-dynamic";

export default async function AdminInvitesPage() {
  const session = await requireOwnerPageSession();
  const invites = await authService.listInvites(session.user.id);

  return (
    <main className="stack">
      <section className="panel stack">
        <div className="pill admin-pill">/admin/invites</div>
        <h1>Invite management</h1>
        <p className="muted">
          Owner-issued invites stay explicit and member-scoped. Active invites
          can be revoked or reissued without opening broader account controls.
        </p>
      </section>

      <InvitesAdminConsole
        appUrl={env.APP_URL}
        initialInvites={invites.map((invite) => ({
          id: invite.id,
          email: invite.email,
          status: invite.status,
          createdAt: invite.createdAt.toISOString(),
          expiresAt: invite.expiresAt.toISOString(),
          acceptedAt: invite.acceptedAt?.toISOString() ?? null,
        }))}
      />
    </main>
  );
}
