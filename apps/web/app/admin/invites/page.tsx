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

import { InvitesAdminConsole } from "../invites-admin-console";

export const dynamic = "force-dynamic";

type AdminInvitesPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AdminInvitesPage({
  searchParams,
}: AdminInvitesPageProps) {
  const [resolvedSearchParams, session, h] = await Promise.all([
    searchParams,
    requireOwnerPageSession(),
    headers(),
  ]);
  const baseUrl = getBaseUrl(h);
  const allInvites = await authService.listInvites(session.user.id);
  const page = parsePage(getSingleSearchParam(resolvedSearchParams, "page"));
  const totalPages = Math.ceil(allInvites.length / PAGE_SIZE);
  const buildHref = buildPageHref("/admin/invites");

  if (totalPages > 0 && page > totalPages) redirect(buildHref(1));

  const invites = allInvites.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <main className="stack" style={{ gap: "40px" }}>
      <section>
        <h1 style={{ marginBottom: "8px" }}>Invite management</h1>
        <p className="muted" style={{ maxWidth: "56ch" }}>
          Owner-issued invites stay explicit and member-scoped. Active invites
          can be revoked or reissued without opening broader account controls.
        </p>
      </section>

      <InvitesAdminConsole
        appUrl={baseUrl}
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
