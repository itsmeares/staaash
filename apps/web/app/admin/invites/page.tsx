import { getSingleSearchParam } from "@/app/auth-ui";
import {
  PAGE_SIZE,
  PaginationControls,
  parsePage,
} from "@/app/pagination-controls";
import { env } from "@/lib/env";
import { requireOwnerPageSession } from "@/server/auth/guards";
import { authService } from "@/server/auth/service";

import { InvitesAdminConsole } from "../invites-admin-console";

export const dynamic = "force-dynamic";

type AdminInvitesPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AdminInvitesPage({
  searchParams,
}: AdminInvitesPageProps) {
  const [resolvedSearchParams, session] = await Promise.all([
    searchParams,
    requireOwnerPageSession(),
  ]);
  const allInvites = await authService.listInvites(session.user.id);
  const page = parsePage(getSingleSearchParam(resolvedSearchParams, "page"));
  const totalPages = Math.ceil(allInvites.length / PAGE_SIZE);
  const invites = allInvites.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const buildHref = (p: number) =>
    p === 1 ? "/admin/invites" : `/admin/invites?page=${p}`;

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

      <PaginationControls
        buildHref={buildHref}
        page={page}
        totalPages={totalPages}
      />
    </main>
  );
}
