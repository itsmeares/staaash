import { ChevronLeft } from "lucide-react";
import { AppLink } from "@/components/app-link";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Fragment, type ReactNode } from "react";

import { Avatar } from "@staaash/ui/components/avatar";
import { Badge } from "@staaash/ui/components/badge";
import { DateTime } from "@/components/time-provider";
import { Button } from "@staaash/ui/components/button";
import { getInitials } from "@/lib/user";
import { adminUserQuery } from "@/src/queries";

import {
  AccountCard,
  MemberKeys,
  SignInRows,
  UserDevices,
} from "./user-account";
import { AdminGroup, AdminPage } from "./admin-panel";
import { UserDetailCopyButton } from "./user-detail-copy-button";
import { SpaceUse } from "./users-admin-console";

const plural = (count: number, word: string) =>
  `${count} ${word}${count === 1 ? "" : "s"}`;

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="m-0 min-w-0 text-end">{children}</dd>
    </div>
  );
}

// Long paths and emails break after a slash, dash, dot or @, never mid-word.
const breakable = (text: string) =>
  text.split(/(?<=[/.@-])/).map((part, index) => (
    <Fragment key={index}>
      {index ? <wbr /> : null}
      {part}
    </Fragment>
  ));

const roleOf = (user: { isOwner: boolean; isAdmin: boolean }) =>
  user.isOwner ? "Owner" : user.isAdmin ? "Admin" : "Member";

export function AdminUserPage({ userId }: { userId: string }) {
  const { canEdit, user, storage, devices, keys, signInUrl, sso } =
    useSuspenseQuery(adminUserQuery(userId)).data;
  const limit = user.storageLimitBytes;
  const folder = `files/${user.storageId}`;

  return (
    <AdminPage>
      <Button
        className="-ms-2 -mb-3 justify-self-start"
        render={<AppLink href="/admin/users" />}
        size="sm"
        variant="ghost-muted"
      >
        <ChevronLeft aria-hidden />
        Users
      </Button>
      <div className="grid items-start gap-6 lg:grid-cols-[17rem_minmax(0,1fr)]">
        <aside className="grid min-w-0 gap-5 rounded-2xl border border-border bg-card p-5">
          <div className="flex min-w-0 items-start gap-3">
            <Avatar
              avatarUrl={user.avatarUrl}
              initials={getInitials(user.displayName, user.email)}
              size="xl"
            />
            <div className="grid min-w-0 flex-1 gap-0.5 pt-0.5">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <h1 className="m-0 min-w-0 font-heading text-lg font-semibold wrap-break-word">
                  {user.displayName ?? user.email}
                </h1>
                <Badge variant={user.isOwner ? "accent" : "neutral"}>
                  {roleOf(user)}
                </Badge>
              </div>
              <p className="m-0 text-meta text-muted-foreground">
                {breakable(user.email)}
              </p>
              {user.note ? (
                <p className="m-0 text-meta text-warning-foreground">
                  {user.note}
                </p>
              ) : null}
            </div>
          </div>
          <div className="grid gap-4 border-t border-border pt-4 text-meta">
            <div className="grid gap-1.5">
              <SpaceUse large limit={limit} used={storage.used} />
              <span className="text-label text-muted-foreground">
                {plural(storage.files, "file")} ·{" "}
                {plural(storage.folders, "folder")}
              </span>
            </div>
            <dl className="m-0 grid gap-1.5">
              <Fact label="Joined">
                <DateTime value={user.createdAt} />
              </Fact>
              {storage.lastChange ? (
                <Fact label="Last change">
                  <DateTime value={storage.lastChange} />
                </Fact>
              ) : null}
            </dl>
            <div className="grid gap-1">
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Folder</span>
                <UserDetailCopyButton compact label="folder" value={folder} />
              </div>
              <code className="text-label text-foreground/80">
                {breakable(folder)}
              </code>
            </div>
          </div>
        </aside>
        <div className="grid min-w-0 gap-6">
          <AccountCard
            account={{
              id: user.id,
              email: user.email,
              displayName: user.displayName,
              isOwner: user.isOwner,
              isAdmin: user.isAdmin,
              storageLimitBytes: limit ?? "",
            }}
            below={
              <>
                <AdminGroup title="Signed in">
                  <UserDevices
                    canEdit={canEdit}
                    devices={devices}
                    hasKeys={keys.length > 0}
                    userId={user.id}
                  />
                </AdminGroup>
                <MemberKeys canEdit={canEdit} keys={keys} userId={user.id} />
              </>
            }
            canEdit={canEdit}
          >
            <SignInRows
              oidcLinked={user.oidcLinked}
              signInUrl={signInUrl}
              sso={sso}
              userId={user.id}
            />
          </AccountCard>
        </div>
      </div>
    </AdminPage>
  );
}
