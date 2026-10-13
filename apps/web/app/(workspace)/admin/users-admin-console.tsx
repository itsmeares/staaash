"use client";

import { ChevronRight, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { BYTES, UnitField } from "@/components/settings-layout";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { formatBytes } from "@/lib/format-bytes";
import { getInitials, roleLabel } from "@/lib/user";

import { AdminAvatar } from "./admin-avatar";
import { AdminToggleField } from "./admin-toggle-field";
import {
  AdminFormDialog,
  sendAdmin,
  type TemporaryPassword,
  TemporaryPasswordDialog,
  TemporaryPasswordFields,
  temporaryPasswordPayload,
} from "./temporary-password";

export type AdminUserRow = {
  id: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  role: "owner" | "admin" | "member";
  storageLimitBytes: string | null;
  storageUsedBytes: string;
  /** From `accountNote`. */
  note: string | null;
};

const usedPercent = (user: AdminUserRow) =>
  user.storageLimitBytes
    ? Math.min(
        100,
        Number(
          (BigInt(user.storageUsedBytes) * 100n) /
            BigInt(user.storageLimitBytes),
        ),
      )
    : null;

function UserRow({ user }: { user: AdminUserRow }) {
  const percent = usedPercent(user);
  return (
    <Link
      className="flex min-h-15 items-center gap-3 border-t border-border px-4 py-2.5 outline-none first:border-t-0 hover:bg-hover focus-visible:bg-hover"
      href={`/admin/users/${user.id}`}
    >
      <AdminAvatar
        avatarUrl={user.avatarUrl}
        initials={getInitials(user.displayName, user.email)}
        size="sm"
      />
      <span className="grid min-w-0 flex-1">
        <span className="truncate text-body font-medium">
          {user.displayName ?? user.email}
        </span>
        <span className="truncate text-label text-muted-foreground">
          {user.note ? (
            <span className="text-warning-foreground">{user.note}</span>
          ) : (
            user.email
          )}
        </span>
      </span>
      <Badge variant={user.role === "owner" ? "accent" : "neutral"}>
        {roleLabel(user.role)}
      </Badge>
      <span className="hidden w-40 gap-1.5 text-end sm:grid">
        <span className="text-label text-muted-foreground tabular-nums">
          {formatBytes(BigInt(user.storageUsedBytes))}
          {user.storageLimitBytes
            ? ` of ${formatBytes(BigInt(user.storageLimitBytes))}`
            : ""}
        </span>
        {percent === null ? null : (
          <span className="block h-1 overflow-hidden rounded-full bg-pressed">
            <span
              className="block h-full rounded-full bg-primary"
              style={{ width: `${percent}%` }}
            />
          </span>
        )}
      </span>
      <ChevronRight aria-hidden className="size-4 text-muted-foreground" />
    </Link>
  );
}

function InviteDialog({ signInUrl }: { signInUrl: string }) {
  const router = useRouter();
  const [limit, setLimit] = useState("");
  const [result, setResult] = useState<TemporaryPassword | null>(null);

  const invite = async (form: FormData) => {
    const body = await sendAdmin<{
      user: { email: string };
      temporaryPassword: string;
    }>("/api/admin/users", "POST", {
      email: String(form.get("email") ?? ""),
      ...temporaryPasswordPayload(form),
      storageLimitBytes: limit || null,
      isAdmin: form.get("isAdmin") === "on",
    });
    setResult({
      email: body.user.email,
      temporaryPassword: body.temporaryPassword,
      signInUrl,
    });
    setLimit("");
    router.refresh();
  };

  return (
    <>
      <AdminFormDialog
        submitLabel="Invite"
        title="Invite someone"
        trigger={<Button className="max-sm:w-full" />}
        triggerLabel={
          <>
            <Plus aria-hidden />
            Invite
          </>
        }
        onSubmit={invite}
      >
        <Field>
          <FieldLabel>Email</FieldLabel>
          <Input
            autoComplete="off"
            name="email"
            placeholder="name@example.com"
            required
            type="email"
          />
        </Field>
        <Field>
          <FieldLabel>Storage limit</FieldLabel>
          <UnitField
            emptyUnit="GB"
            id="invite-limit"
            name="storageLimitBytes"
            placeholder="No limit"
            units={BYTES}
            value={limit}
            onChange={setLimit}
          />
        </Field>
        <TemporaryPasswordFields />
        <AdminToggleField label="Can open the admin pages" name="isAdmin" />
      </AdminFormDialog>
      <TemporaryPasswordDialog
        result={result}
        onClose={() => setResult(null)}
      />
    </>
  );
}

export function UsersAdminConsole({
  users,
  signInUrl,
  canInvite,
}: {
  users: AdminUserRow[];
  signInUrl: string;
  canInvite: boolean;
}) {
  return (
    <div className="grid w-full max-w-3xl content-start gap-6">
      <PageHeader
        actions={canInvite ? <InviteDialog signInUrl={signInUrl} /> : null}
        title="Users"
      />
      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        {users.map((user) => (
          <UserRow key={user.id} user={user} />
        ))}
      </div>
    </div>
  );
}
