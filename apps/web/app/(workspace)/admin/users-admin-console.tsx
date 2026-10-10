"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useMemo, useState, useTransition } from "react";
import {
  Copy,
  Edit2,
  KeyRound,
  MoreHorizontal,
  Plus,
  RotateCw,
} from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Menu,
  MenuItem,
  MenuLinkItem,
  MenuPopup,
  MenuTrigger,
} from "@/components/ui/menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { formatAdminBytes } from "./admin-format";
import { AdminAvatar } from "./admin-avatar";
import { AdminStatusBadge } from "./admin-status-badge";
import { AdminToggleField } from "./admin-toggle-field";

type AdminUser = {
  id: string;
  email: string;
  storageId: string;
  displayName: string | null;
  isOwner: boolean;
  isAdmin: boolean;
  createdAt: string;
  updatedAt: string;
  storageLimitBytes: string | null;
  storageUsedBytes: string;
  passwordChangeRequiredAt: string | null;
  onboardingCompletedAt: string | null;
};

type UsersAdminConsoleProps = {
  initialUsers: AdminUser[];
  appUrl: string;
  canMutateUsers: boolean;
  summary: AdminUsersSummary;
};

type AdminUsersSummary = {
  total: number;
  owners: number;
  admins: number;
  members: number;
  pendingOnboarding: number;
  passwordChangeRequired: number;
};

type PasswordResult = {
  email: string;
  temporaryPassword: string;
  signInUrl: string;
};

const BYTES_PER_GIB = 1024n * 1024n * 1024n;

const toGibInput = (bytes: string | null) =>
  bytes ? (BigInt(bytes) / BYTES_PER_GIB).toString() : "";

const fromGibInput = (value: string) => {
  if (value.trim() === "") return null;
  return (BigInt(value) * BYTES_PER_GIB).toString();
};

const quotaLabel = (user: AdminUser) =>
  user.storageLimitBytes
    ? formatAdminBytes(BigInt(user.storageLimitBytes))
    : "∞";

const roleLabel = (user: AdminUser) =>
  user.isOwner ? "owner" : user.isAdmin ? "admin" : "member";

const plural = (
  count: number,
  singular: string,
  pluralLabel = `${singular}s`,
) => `${count} ${count === 1 ? singular : pluralLabel}`;

const buildUserWarnings = (user: AdminUser) => [
  ...(user.passwordChangeRequiredAt ? ["must change password"] : []),
  ...(!user.onboardingCompletedAt ? ["setup not finished"] : []),
];

const initialsOf = (user: AdminUser) =>
  (user.displayName ?? user.email)
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");

const formString = (value: FormDataEntryValue | null) =>
  typeof value === "string" ? value : undefined;

const temporaryPasswordPayload = (form: FormData, generated: boolean) =>
  generated
    ? {
        generateTemporaryPassword: true,
      }
    : {
        generateTemporaryPassword: false,
        temporaryPassword: formString(form.get("temporaryPassword")),
        confirmTemporaryPassword: formString(
          form.get("confirmTemporaryPassword"),
        ),
      };

const copyText = async (value: string) => {
  await navigator.clipboard.writeText(value);
};

function PasswordFields({ generated }: { generated: boolean }) {
  if (generated) return null;

  return (
    <>
      <Field>
        <FieldLabel>Temporary password</FieldLabel>
        <Input
          name="temporaryPassword"
          type="password"
          minLength={12}
          required
        />
      </Field>
      <Field>
        <FieldLabel>Confirm temporary password</FieldLabel>
        <Input
          name="confirmTemporaryPassword"
          type="password"
          minLength={12}
          required
        />
      </Field>
    </>
  );
}

function QuotaFields({ defaultBytes }: { defaultBytes?: string | null }) {
  return (
    <Field>
      <FieldLabel>Quota size (GiB)</FieldLabel>
      <Input
        name="quotaGiB"
        type="number"
        min={1}
        step={1}
        inputMode="numeric"
        defaultValue={toGibInput(defaultBytes ?? null)}
        placeholder="Unlimited"
      />
      <FieldDescription>Leave blank for unlimited.</FieldDescription>
    </Field>
  );
}

function FormActions({
  onCancel,
  children,
}: {
  onCancel: () => void;
  children: React.ReactNode;
}) {
  return (
    <DialogFooter>
      <Button variant="secondary" onClick={onCancel}>
        Cancel
      </Button>
      {children}
    </DialogFooter>
  );
}

export function UsersAdminConsole({
  initialUsers,
  appUrl,
  canMutateUsers,
  summary,
}: UsersAdminConsoleProps) {
  const router = useRouter();
  const [isRefreshing, startTransition] = useTransition();
  const [createError, setCreateError] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [resetError, setResetError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editUser, setEditUser] = useState<AdminUser | null>(null);
  const [resetUser, setResetUser] = useState<AdminUser | null>(null);
  const [createGenerated, setCreateGenerated] = useState(true);
  const [resetGenerated, setResetGenerated] = useState(true);
  const [passwordResult, setPasswordResult] = useState<PasswordResult | null>(
    null,
  );
  const signInUrl = useMemo(() => new URL("/", appUrl).toString(), [appUrl]);

  const refresh = () => {
    startTransition(() => {
      router.refresh();
    });
  };

  const parseError = async (response: Response) => {
    try {
      const body = (await response.json()) as { error?: string };
      return body.error ?? "Request failed.";
    } catch {
      return "Request failed.";
    }
  };

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreateError(null);

    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/admin/users", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        email: String(form.get("email") ?? ""),
        ...temporaryPasswordPayload(form, createGenerated),
        storageLimitBytes: fromGibInput(String(form.get("quotaGiB") ?? "")),
        isAdmin: form.get("isAdmin") === "on",
        requirePasswordChange: form.get("requirePasswordChange") === "on",
      }),
    });

    if (!response.ok) {
      setCreateError(await parseError(response));
      return;
    }

    const body = (await response.json()) as {
      user: { email: string };
      temporaryPassword: string;
    };
    setPasswordResult({
      email: body.user.email,
      temporaryPassword: body.temporaryPassword,
      signInUrl,
    });
    setCreateOpen(false);
    refresh();
  }

  async function handleEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editUser) return;
    setEditError(null);

    const form = new FormData(event.currentTarget);
    const response = await fetch(`/api/admin/users/${editUser.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        email: String(form.get("email") ?? ""),
        displayName: String(form.get("displayName") ?? ""),
        storageLimitBytes: fromGibInput(String(form.get("quotaGiB") ?? "")),
        isAdmin: editUser.isOwner ? true : form.get("isAdmin") === "on",
      }),
    });

    if (!response.ok) {
      setEditError(await parseError(response));
      return;
    }

    setEditUser(null);
    refresh();
  }

  async function handleReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!resetUser) return;
    setResetError(null);

    const form = new FormData(event.currentTarget);
    const response = await fetch(
      `/api/admin/users/${resetUser.id}/password-reset`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          ...temporaryPasswordPayload(form, resetGenerated),
          requirePasswordChange: form.get("requirePasswordChange") === "on",
        }),
      },
    );

    if (!response.ok) {
      setResetError(await parseError(response));
      return;
    }

    const body = (await response.json()) as {
      user: { email: string };
      temporaryPassword: string;
      signInUrl: string;
    };
    setPasswordResult({
      email: body.user.email,
      temporaryPassword: body.temporaryPassword,
      signInUrl: body.signInUrl,
    });
    setResetUser(null);
    refresh();
  }

  return (
    <div className="mx-auto grid w-[min(1180px,100%)] grid-cols-1 gap-5.5 max-sm:w-full">
      <PageHeader
        title="Users"
        meta={
          <span className="text-meta text-muted-foreground">
            {plural(summary.total, "account")}
            {summary.pendingOnboarding > 0
              ? `, ${plural(summary.pendingOnboarding, "user")} not set up yet`
              : ""}
            {summary.passwordChangeRequired > 0
              ? `, ${plural(summary.passwordChangeRequired, "password")} to change`
              : ""}
          </span>
        }
        actions={
          canMutateUsers ? (
            <Dialog
              open={createOpen}
              onOpenChange={(open) => {
                setCreateOpen(open);
                if (open) setCreateError(null);
              }}
            >
              <DialogTrigger render={<Button className="max-sm:w-full" />}>
                <Plus aria-hidden />
                Invite a user
              </DialogTrigger>
              <DialogPopup className="max-w-110">
                <form className="flex min-h-0 flex-col" onSubmit={handleCreate}>
                  <DialogHeader>
                    <DialogTitle>Invite a user</DialogTitle>
                  </DialogHeader>
                  <DialogPanel className="grid grid-cols-1 gap-4">
                    <Field>
                      <FieldLabel>Email</FieldLabel>
                      <Input
                        name="email"
                        type="email"
                        autoComplete="email"
                        required
                      />
                    </Field>
                    <AdminToggleField
                      checked={createGenerated}
                      label="Generate temporary password"
                      onChange={setCreateGenerated}
                    />
                    <PasswordFields generated={createGenerated} />
                    <QuotaFields />
                    <AdminToggleField name="isAdmin" label="Admin user" />
                    <AdminToggleField
                      name="requirePasswordChange"
                      label="Require password change on first login"
                      defaultChecked
                    />
                    {createError ? (
                      <Alert variant="error">{createError}</Alert>
                    ) : null}
                  </DialogPanel>
                  <FormActions onCancel={() => setCreateOpen(false)}>
                    <Button type="submit">Invite user</Button>
                  </FormActions>
                </form>
              </DialogPopup>
            </Dialog>
          ) : null
        }
      />

      <section className="grid grid-cols-1 gap-3">
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <Table className="min-w-180 table-fixed">
            <TableHeader>
              <TableRow>
                <TableHead className="w-[30%] px-4">Name</TableHead>
                <TableHead className="w-[30%] px-4">Email</TableHead>
                <TableHead className="w-[13%] px-4">Role</TableHead>
                <TableHead className="w-[20%] px-4">Storage</TableHead>
                <TableHead className="w-14 px-3">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {initialUsers.map((user) => {
                const warnings = buildUserWarnings(user);

                return (
                  <TableRow key={user.id}>
                    <TableCell className="px-4 py-2.5 whitespace-normal">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <AdminAvatar
                          avatarUrl={null}
                          initials={initialsOf(user)}
                          size="sm"
                        />
                        <div className="grid min-w-0">
                          <Link
                            className="truncate text-body font-medium hover:underline"
                            href={`/admin/users/${user.id}`}
                          >
                            {user.displayName ?? "No name yet"}
                          </Link>
                          {warnings.length > 0 ? (
                            <span className="text-label text-warning-foreground">
                              {warnings.join(", ")}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="truncate px-4 py-2.5 text-body text-muted-foreground">
                      {user.email}
                    </TableCell>
                    <TableCell className="px-4 py-2.5">
                      <AdminStatusBadge status={roleLabel(user)} />
                    </TableCell>
                    <TableCell className="px-4 py-2.5">
                      <div className="grid gap-1.5">
                        <span className="text-meta tabular-nums">
                          {formatAdminBytes(BigInt(user.storageUsedBytes))} of{" "}
                          {user.storageLimitBytes
                            ? quotaLabel(user)
                            : "unlimited"}
                        </span>
                        {user.storageLimitBytes ? (
                          <span className="block h-1 overflow-hidden rounded-full bg-pressed">
                            <span
                              className="block h-full rounded-full bg-primary"
                              style={{
                                width: `${Math.min(
                                  100,
                                  Number(
                                    (BigInt(user.storageUsedBytes) * 100n) /
                                      BigInt(user.storageLimitBytes),
                                  ),
                                )}%`,
                              }}
                            />
                          </span>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="py-2.5 pr-3 pl-2 text-right">
                      <Menu>
                        <MenuTrigger
                          render={
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`Open actions for ${user.email}`}
                            />
                          }
                        >
                          <MoreHorizontal aria-hidden />
                        </MenuTrigger>
                        <MenuPopup align="end" className="min-w-52">
                          <MenuLinkItem
                            render={<Link href={`/admin/users/${user.id}`} />}
                          >
                            Details
                          </MenuLinkItem>
                          {canMutateUsers ? (
                            <>
                              <MenuItem
                                onClick={() => {
                                  setEditError(null);
                                  setEditUser(user);
                                }}
                                disabled={isRefreshing}
                              >
                                <Edit2 aria-hidden />
                                Edit
                              </MenuItem>
                              <MenuItem
                                onClick={() => {
                                  setResetError(null);
                                  setResetUser(user);
                                }}
                                disabled={isRefreshing}
                              >
                                <KeyRound aria-hidden />
                                Reset password
                              </MenuItem>
                            </>
                          ) : null}
                        </MenuPopup>
                      </Menu>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </section>

      <Dialog
        open={Boolean(editUser)}
        onOpenChange={(open) => {
          if (!open) setEditUser(null);
          if (open) setEditError(null);
        }}
      >
        <DialogPopup className="max-w-110">
          <DialogHeader>
            <DialogTitle>Edit user</DialogTitle>
          </DialogHeader>
          {editUser ? (
            <form className="flex min-h-0 flex-col" onSubmit={handleEdit}>
              <DialogPanel className="grid grid-cols-1 gap-4">
                <Field>
                  <FieldLabel>Email</FieldLabel>
                  <Input
                    name="email"
                    type="email"
                    defaultValue={editUser.email}
                    required
                  />
                </Field>
                <Field>
                  <FieldLabel>Name</FieldLabel>
                  <Input
                    name="displayName"
                    defaultValue={editUser.displayName ?? ""}
                  />
                </Field>
                <QuotaFields defaultBytes={editUser.storageLimitBytes} />
                <AdminToggleField
                  name="isAdmin"
                  label="Admin user"
                  defaultChecked={editUser.isAdmin}
                  disabled={editUser.isOwner}
                />
                {editError ? <Alert variant="error">{editError}</Alert> : null}
              </DialogPanel>
              <FormActions onCancel={() => setEditUser(null)}>
                <Button type="submit">Save changes</Button>
              </FormActions>
            </form>
          ) : null}
        </DialogPopup>
      </Dialog>

      <Dialog
        open={Boolean(resetUser)}
        onOpenChange={(open) => {
          if (!open) setResetUser(null);
          if (open) setResetError(null);
        }}
      >
        <DialogPopup className="max-w-110">
          <DialogHeader>
            <DialogTitle>Reset password</DialogTitle>
          </DialogHeader>
          {resetUser ? (
            <form className="flex min-h-0 flex-col" onSubmit={handleReset}>
              <DialogPanel className="grid grid-cols-1 gap-4">
                <p className="m-0 text-meta text-muted-foreground">
                  Existing sessions for {resetUser.email} will be revoked
                  immediately.
                </p>
                <AdminToggleField
                  checked={resetGenerated}
                  label="Generate temporary password"
                  onChange={setResetGenerated}
                />
                <PasswordFields generated={resetGenerated} />
                <AdminToggleField
                  name="requirePasswordChange"
                  label="Require password change on next login"
                  defaultChecked
                />
                {resetError ? (
                  <Alert variant="error">{resetError}</Alert>
                ) : null}
              </DialogPanel>
              <FormActions onCancel={() => setResetUser(null)}>
                <Button type="submit">
                  <RotateCw aria-hidden />
                  Reset password
                </Button>
              </FormActions>
            </form>
          ) : null}
        </DialogPopup>
      </Dialog>

      <Dialog
        open={Boolean(passwordResult)}
        onOpenChange={(open) => !open && setPasswordResult(null)}
      >
        <DialogPopup className="max-w-110">
          <DialogHeader>
            <DialogTitle>Temporary password</DialogTitle>
          </DialogHeader>
          {passwordResult ? (
            <PasswordResultPanel result={passwordResult} />
          ) : null}
        </DialogPopup>
      </Dialog>
    </div>
  );
}

function PasswordResultPanel({ result }: { result: PasswordResult }) {
  return (
    <DialogPanel className="grid grid-cols-1 gap-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <span className="text-meta text-muted-foreground">
          Copy now. This password is only shown in this response.
        </span>
        <Button
          variant="secondary"
          onClick={() =>
            copyText(
              `Email: ${result.email}\nTemporary password: ${result.temporaryPassword}\nSign in: ${result.signInUrl}`,
            )
          }
        >
          <Copy aria-hidden />
          Copy
        </Button>
      </div>
      <dl className="m-0 grid grid-cols-1 gap-2">
        <ResultRow label="Email">{result.email}</ResultRow>
        <ResultRow label="Password">
          <code>{result.temporaryPassword}</code>
        </ResultRow>
        <ResultRow label="Sign in">{result.signInUrl}</ResultRow>
      </dl>
    </DialogPanel>
  );
}

function ResultRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[92px_minmax(0,1fr)] gap-3">
      <dt className="text-meta text-muted-foreground">{label}</dt>
      <dd className="m-0 min-w-0 text-meta wrap-anywhere">{children}</dd>
    </div>
  );
}
