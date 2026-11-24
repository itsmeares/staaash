import { useRefresh } from "@/lib/use-refresh";
import { ChevronRight, Plus } from "lucide-react";
import { AppLink } from "@/components/app-link";
import { useState } from "react";

import { BYTES, UnitField } from "@/components/settings-layout";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@staaash/ui/components/badge";
import { Button } from "@staaash/ui/components/button";
import { Field, FieldLabel } from "@staaash/ui/components/field";
import { Input } from "@staaash/ui/components/input";
import { formatBytes } from "@/lib/format-bytes";
import { getInitials, roleLabel } from "@/lib/user";

import { AdminAvatar } from "./admin-avatar";
import { AdminToggleField } from "./admin-toggle-field";
import {
  AdminFormDialog,
  sendAdmin,
  type SignInDetails,
  SignInDetailsDialog,
  type Sso,
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
    <AppLink
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
    </AppLink>
  );
}

function InviteDialog({
  signInUrl,
  sso,
}: {
  signInUrl: string;
  sso: Sso | null;
}) {
  const refresh = useRefresh();
  const [limit, setLimit] = useState("");
  // With single sign-on set up, inviting through it is the usual choice.
  const [viaSso, setViaSso] = useState(sso !== null);
  const [result, setResult] = useState<SignInDetails | null>(null);

  const invite = async (form: FormData) => {
    const body = await sendAdmin<{
      user: { email: string };
      temporaryPassword: string | null;
      inviteUrl: string | null;
    }>("/api/admin/users", "POST", {
      email: String(form.get("email") ?? ""),
      ...(viaSso ? { signInWith: "oidc" } : temporaryPasswordPayload(form)),
      storageLimitBytes: limit || null,
      isAdmin: form.get("isAdmin") === "on",
    });
    setResult({
      email: body.user.email,
      temporaryPassword: body.temporaryPassword,
      inviteUrl: body.inviteUrl,
      signInUrl,
    });
    setLimit("");
    void refresh();
  };

  return (
    <>
      <AdminFormDialog
        submitLabel="Invite"
        title="Invite someone"
        trigger={<Button />}
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
        {sso?.passwordLogin ? (
          <AdminToggleField
            checked={viaSso}
            label={`Signs in with ${sso.name}`}
            onChange={setViaSso}
          />
        ) : null}
        {viaSso ? null : <TemporaryPasswordFields />}
        <AdminToggleField label="Admin access" name="isAdmin" />
      </AdminFormDialog>
      <SignInDetailsDialog result={result} onClose={() => setResult(null)} />
    </>
  );
}

export function UsersAdminConsole({
  users,
  signInUrl,
  sso,
  canInvite,
}: {
  users: AdminUserRow[];
  signInUrl: string;
  sso: Sso | null;
  canInvite: boolean;
}) {
  return (
    <div className="grid w-full max-w-3xl content-start gap-6">
      <PageHeader
        actions={
          canInvite ? <InviteDialog signInUrl={signInUrl} sso={sso} /> : null
        }
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
