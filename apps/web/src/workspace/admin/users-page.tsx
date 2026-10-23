import { useSuspenseQuery } from "@tanstack/react-query";

import { PAGE_SIZE, PaginationControls, buildPageHref } from "@/src/pagination-controls";
import { adminUsersQuery } from "@/src/queries";

import { UsersAdminConsole } from "./users-admin-console";

export function AdminUsersPage({ page }: { page: number }) {
  const { canInvite, signInUrl, users } = useSuspenseQuery(adminUsersQuery).data;
  const totalPages = Math.ceil(users.length / PAGE_SIZE);
  const current = Math.min(page, Math.max(totalPages, 1));

  return (
    <main className="m-0 grid w-full gap-4 p-0">
      <UsersAdminConsole
        canInvite={canInvite}
        signInUrl={signInUrl}
        users={users.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE)}
      />

      {totalPages > 1 ? (
        <div className="flex max-w-3xl justify-end">
          <PaginationControls
            buildHref={buildPageHref("/admin/users")}
            page={current}
            totalPages={totalPages}
          />
        </div>
      ) : null}
    </main>
  );
}
