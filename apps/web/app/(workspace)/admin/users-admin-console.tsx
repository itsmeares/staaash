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
import { AdminStatCard } from "./admin-stat-card";
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

const roleSummaryLabel = (summary: AdminUsersSummary) =>
  [
    plural(summary.owners, "owner"),
    plural(summary.admins, "admin"),
    plural(summary.members, "member"),
  ].join(", ");

const onboardingSummaryLabel = (count: number) =>
  count === 0 ? "No pending setup" : `${plural(count, "user")} pending setup`;

const passwordSummaryLabel = (count: number) =>
  count === 0
    ? "No forced password changes"
    : `${plural(count, "user")} must change password`;

const buildUserWarnings = (user: AdminUser) => [
  ...(user.passwordChangeRequiredAt ? ["password change required"] : []),
  ...(!user.onboardingCompletedAt ? ["onboarding incomplete"] : []),
];

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
        size="lg"
        divider
        title="User management"
        description="Accounts, storage quotas, onboarding state, and device sessions."
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

      <section className="grid grid-cols-1 gap-4">
        <div
          className="grid grid-cols-3 gap-3 max-lg:grid-cols-1"
          aria-label="User summary"
        >
          <AdminStatCard
            label="Accounts"
            value={String(summary.total)}
            detail={roleSummaryLabel(summary)}
          />
          <AdminStatCard
            label="Onboarding"
            value={String(summary.pendingOnboarding)}
            detail={onboardingSummaryLabel(summary.pendingOnboarding)}
          />
          <AdminStatCard
            label="Password changes"
            value={String(summary.passwordChangeRequired)}
            detail={passwordSummaryLabel(summary.passwordChangeRequired)}
          />
        </div>

        <div className="overflow-hidden rounded-lg border border-hairline bg-card">
          <Table className="min-w-205 table-fixed">
            <TableHeader>
              <TableRow>
                <TableHead className="w-[26%] px-5">Name</TableHead>
                <TableHead className="w-[36%] px-5">Email</TableHead>
                <TableHead className="w-[14%] px-5">Role</TableHead>
                <TableHead className="w-[12%] px-5">Quota</TableHead>
                <TableHead className="w-16 px-3">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {initialUsers.map((user) => {
                const warnings = buildUserWarnings(user);

                return (
                  <TableRow key={user.id}>
                    <TableCell className="p-5 whitespace-normal">
                      <div className="grid grid-cols-1 gap-1.5">
                        <Link
                          className="text-base font-semibold text-foreground underline decoration-primary/50 underline-offset-3 hover:text-primary-ink"
                          href={`/admin/users/${user.id}`}
                        >
                          {user.displayName ?? "No name yet"}
                        </Link>
                        {warnings.length > 0 ? (
                          <span className="text-meta font-medium text-destructive-foreground">
                            {warnings.join(" · ")}
                          </span>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="p-5 text-base wrap-anywhere whitespace-normal">
                      {user.email}
                    </TableCell>
                    <TableCell className="p-5">
                      <AdminStatusBadge status={roleLabel(user)} size="lg" />
                    </TableCell>
                    <TableCell className="p-5 font-heading text-xl font-semibold">
                      {quotaLabel(user)}
                    </TableCell>
                    <TableCell className="py-5 pr-4 pl-3 text-right">
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
        <div className="justify-self-end px-0.5 text-meta text-muted-foreground">
          {initialUsers.length} shown
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
