import { ChevronLeft } from "lucide-react";
import { AppLink } from "@/components/app-link";
import { useSuspenseQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { AdminAvatar } from "./admin-avatar";
import { SettingsCard, SettingsRow } from "@/components/settings-layout";
import { DateTime } from "@/components/time-provider";
import { Button } from "@staaash/ui/components/button";
import { formatBytes } from "@/lib/format-bytes";
import { getInitials } from "@/lib/user";
import { adminUserQuery } from "@/src/queries";

import { AccountCard, SignInCard } from "./user-account";
import { UserDetailCopyButton } from "./user-detail-copy-button";

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-2.5">
      <h2 className="m-0 font-heading text-body font-semibold">{title}</h2>
      {children}
    </section>
  );
}

const plural = (count: number, word: string) =>
  `${count} ${word}${count === 1 ? "" : "s"}`;

function StorageCard({
  used,
  limit,
  files,
  folders,
  lastChange,
}: {
  used: bigint;
  limit: bigint | null;
  files: number;
  folders: number;
  lastChange: string | null;
}) {
  const percent = limit
    ? Math.min(100, Number((used * 1000n) / limit) / 10)
    : null;
  return (
    <SettingsCard>
      <div className="grid gap-2.5 px-4 py-3.5">
        <span className="text-body">
          <b className="font-semibold tabular-nums">{formatBytes(used)}</b>{" "}
          <span className="text-muted-foreground">
            {limit ? `of ${formatBytes(limit)}` : "used"}
          </span>
        </span>
        {percent === null ? null : (
          <span className="block h-2 overflow-hidden rounded-full bg-hover">
            <span
              className="block h-full rounded-full bg-primary"
              style={{ width: `${percent}%` }}
            />
          </span>
        )}
        <span className="text-label text-muted-foreground">
          {plural(files, "file")} · {plural(folders, "folder")}
          {lastChange ? (
            <>
              {" "}
              · last change <DateTime value={lastChange} />
            </>
          ) : null}
        </span>
      </div>
    </SettingsCard>
  );
}

export function AdminUserPage({ userId }: { userId: string }) {
  const { canEdit, user, storage, devices, signInUrl } = useSuspenseQuery(
    adminUserQuery(userId),
  ).data;
  const limit = user.storageLimitBytes;
  const note = user.note;

  return (
    <div className="grid w-full max-w-3xl content-start gap-6">
      <div className="grid gap-3">
        <Button
          className="-ms-2 justify-self-start"
          render={<AppLink href="/admin/users" />}
          size="sm"
          variant="ghost-muted"
        >
          <ChevronLeft aria-hidden />
          Users
        </Button>
        <div className="flex min-w-0 items-center gap-3.5">
          <AdminAvatar
            avatarUrl={user.avatarUrl}
            initials={getInitials(user.displayName, user.email)}
            size="lg"
          />
          <div className="grid min-w-0 gap-0.5">
            <h1 className="m-0 truncate font-heading text-headline font-semibold">
              {user.displayName ?? user.email}
            </h1>
            <p className="m-0 truncate text-body text-muted-foreground">
              {note ? (
                <span className="text-warning-foreground">{note}</span>
              ) : (
                user.email
              )}
            </p>
          </div>
        </div>
      </div>

      <Group title="Account">
        <AccountCard
          account={{
            id: user.id,
            email: user.email,
            displayName: user.displayName,
            isOwner: user.isOwner,
            isAdmin: user.isAdmin,
            storageLimitBytes: limit ?? "",
          }}
          canEdit={canEdit}
        />
      </Group>

      <Group title="Storage">
        <StorageCard
          files={storage.files}
          folders={storage.folders}
          lastChange={storage.lastChange}
          limit={limit === null ? null : BigInt(limit)}
          used={BigInt(storage.used)}
        />
      </Group>

      <Group title="Signed in">
        <SignInCard
          canEdit={canEdit}
          devices={devices}
          signInUrl={signInUrl}
          userId={user.id}
        />
      </Group>

      <Group title="Details">
        <SettingsCard>
          <SettingsRow label="Joined">
            <DateTime value={user.createdAt} />
          </SettingsRow>
          <SettingsRow label="Folder on disk">
            <span className="flex min-w-0 items-center gap-2">
              <code className="truncate text-label">
                files/{user.storageId}
              </code>
              <UserDetailCopyButton
                label="folder"
                value={`files/${user.storageId}`}
              />
            </span>
          </SettingsRow>
        </SettingsCard>
      </Group>
    </div>
  );
}
