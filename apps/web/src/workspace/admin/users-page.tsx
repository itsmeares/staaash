import { useSuspenseQuery } from "@tanstack/react-query";

import { adminUsersQuery } from "@/src/queries";

import { UsersAdminConsole } from "./users-admin-console";

export function AdminUsersPage({ page }: { page: number }) {
  const { canInvite, signInUrl, sso, users } =
    useSuspenseQuery(adminUsersQuery).data;
  return (
    <main className="m-0 grid w-full gap-4 p-0">
      <UsersAdminConsole
        canInvite={canInvite}
        page={page}
        signInUrl={signInUrl}
        sso={sso}
        users={users}
      />
    </main>
  );
}
