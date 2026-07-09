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

import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

import { formatAdminBytes, getAdminStatusClassName } from "./admin-format";

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
      <label className="field">
        <span>Temporary password</span>
        <input
          name="temporaryPassword"
          type="password"
          minLength={12}
          required
        />
      </label>
      <label className="field">
        <span>Confirm temporary password</span>
        <input
          name="confirmTemporaryPassword"
          type="password"
          minLength={12}
          required
        />
      </label>
    </>
  );
}

function QuotaFields({ defaultBytes }: { defaultBytes?: string | null }) {
  return (
    <label className="field">
      <span>Quota size (GiB)</span>
      <input
        name="quotaGiB"
        type="number"
        min={1}
        step={1}
        inputMode="numeric"
        defaultValue={toGibInput(defaultBytes ?? null)}
        placeholder="Unlimited"
      />
      <span className="field-help">Leave blank for unlimited.</span>
    </label>
  );
}

function ToggleField({
  checked,
  defaultChecked,
  disabled,
  label,
  name,
  onChange,
}: {
  checked?: boolean;
  defaultChecked?: boolean;
  disabled?: boolean;
  label: string;
  name?: string;
  onChange?: (checked: boolean) => void;
}) {
  return (
    <label className="admin-user-toggle-row">
      <span className="settings-toggle">
        <input
          className="settings-toggle-input"
          type="checkbox"
          name={name}
          checked={checked}
          defaultChecked={defaultChecked}
          disabled={disabled}
          onChange={(event) => onChange?.(event.currentTarget.checked)}
        />
        <span className="settings-toggle-track">
          <span className="settings-toggle-thumb" />
        </span>
      </span>
      <span>{label}</span>
    </label>
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
    <div className="stack admin-users-page">
      <section className="admin-users-head">
        <div>
          <h1>User management</h1>
          <p className="muted">
            Accounts, storage quotas, onboarding state, and device sessions.
          </p>
        </div>

        {canMutateUsers ? (
          <Dialog
            open={createOpen}
            onOpenChange={(open) => {
              setCreateOpen(open);
              if (open) setCreateError(null);
            }}
          >
            <DialogTrigger className="button">
              <Plus size={16} aria-hidden />
              Invite a user
            </DialogTrigger>
            <DialogContent className="admin-user-dialog">
              <DialogTitle>Invite a user</DialogTitle>
              <form className="form-grid" onSubmit={handleCreate}>
                <label className="field">
                  <span>Email</span>
                  <input
                    name="email"
                    type="email"
                    autoComplete="email"
                    required
                  />
                </label>
                <ToggleField
                  checked={createGenerated}
                  label="Generate temporary password"
                  onChange={setCreateGenerated}
                />
                <PasswordFields generated={createGenerated} />
                <QuotaFields />
                <ToggleField name="isAdmin" label="Admin user" />
                <ToggleField
                  name="requirePasswordChange"
                  label="Require password change on first login"
                  defaultChecked
                />
                {createError ? (
                  <div className="banner banner-error">{createError}</div>
                ) : null}
                <div className="admin-user-dialog-actions">
                  <button
                    type="button"
                    className="button button-secondary"
                    onClick={() => setCreateOpen(false)}
                  >
                    Cancel
                  </button>
                  <button type="submit" className="button">
                    Invite user
                  </button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        ) : null}
      </section>

      <section className="admin-users-panel">
        <div className="admin-users-summary-strip" aria-label="User summary">
          <div className="admin-users-summary-card">
            <span>Accounts</span>
            <strong>{summary.total}</strong>
            <p>{roleSummaryLabel(summary)}</p>
          </div>
          <div className="admin-users-summary-card">
            <span>Onboarding</span>
            <strong>{summary.pendingOnboarding}</strong>
            <p>{onboardingSummaryLabel(summary.pendingOnboarding)}</p>
          </div>
          <div className="admin-users-summary-card">
            <span>Password changes</span>
            <strong>{summary.passwordChangeRequired}</strong>
            <p>{passwordSummaryLabel(summary.passwordChangeRequired)}</p>
          </div>
        </div>

        <div className="table-wrap">
          <table className="table admin-users-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Quota</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {initialUsers.map((user) => (
                <tr key={user.id}>
                  <td>
                    <div className="admin-user-name-cell">
                      <Link href={`/admin/users/${user.id}`}>
                        {user.displayName ?? "No name yet"}
                      </Link>
                      {buildUserWarnings(user).length > 0 ? (
                        <span className="admin-user-row-note">
                          {buildUserWarnings(user).join(" · ")}
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td>{user.email}</td>
                  <td>
                    <span className={getAdminStatusClassName(roleLabel(user))}>
                      {roleLabel(user)}
                    </span>
                  </td>
                  <td className="admin-user-quota-cell">{quotaLabel(user)}</td>
                  <td>
                    <details className="admin-user-row-menu">
                      <summary aria-label={`Open actions for ${user.email}`}>
                        <MoreHorizontal size={18} aria-hidden />
                      </summary>
                      <div className="admin-user-menu-panel">
                        <Link href={`/admin/users/${user.id}`}>Details</Link>
                        {canMutateUsers ? (
                          <>
                            <button
                              type="button"
                              onClick={() => {
                                setEditError(null);
                                setEditUser(user);
                              }}
                              disabled={isRefreshing}
                            >
                              <Edit2 size={14} aria-hidden />
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setResetError(null);
                                setResetUser(user);
                              }}
                              disabled={isRefreshing}
                            >
                              <KeyRound size={14} aria-hidden />
                              Reset password
                            </button>
                          </>
                        ) : null}
                      </div>
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="admin-users-count">{initialUsers.length} shown</div>
      </section>

      <Dialog
        open={Boolean(editUser)}
        onOpenChange={(open) => {
          if (!open) setEditUser(null);
          if (open) setEditError(null);
        }}
      >
        <DialogContent className="admin-user-dialog">
          <DialogTitle>Edit user</DialogTitle>
          {editUser ? (
            <form className="form-grid" onSubmit={handleEdit}>
              <label className="field">
                <span>Email</span>
                <input
                  name="email"
                  type="email"
                  defaultValue={editUser.email}
                  required
                />
              </label>
              <label className="field">
                <span>Name</span>
                <input
                  name="displayName"
                  defaultValue={editUser.displayName ?? ""}
                />
              </label>
              <QuotaFields defaultBytes={editUser.storageLimitBytes} />
              <ToggleField
                name="isAdmin"
                label="Admin user"
                defaultChecked={editUser.isAdmin}
                disabled={editUser.isOwner}
              />
              {editError ? (
                <div className="banner banner-error">{editError}</div>
              ) : null}
              <div className="admin-user-dialog-actions">
                <button
                  type="button"
                  className="button button-secondary"
                  onClick={() => setEditUser(null)}
                >
                  Cancel
                </button>
                <button type="submit" className="button">
                  Save changes
                </button>
              </div>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(resetUser)}
        onOpenChange={(open) => {
          if (!open) setResetUser(null);
          if (open) setResetError(null);
        }}
      >
        <DialogContent className="admin-user-dialog">
          <DialogTitle>Reset password</DialogTitle>
          {resetUser ? (
            <form className="form-grid" onSubmit={handleReset}>
              <p className="muted">
                Existing sessions for {resetUser.email} will be revoked
                immediately.
              </p>
              <ToggleField
                checked={resetGenerated}
                label="Generate temporary password"
                onChange={setResetGenerated}
              />
              <PasswordFields generated={resetGenerated} />
              <ToggleField
                name="requirePasswordChange"
                label="Require password change on next login"
                defaultChecked
              />
              {resetError ? (
                <div className="banner banner-error">{resetError}</div>
              ) : null}
              <div className="admin-user-dialog-actions">
                <button
                  type="button"
                  className="button button-secondary"
                  onClick={() => setResetUser(null)}
                >
                  Cancel
                </button>
                <button type="submit" className="button">
                  <RotateCw size={14} aria-hidden />
                  Reset password
                </button>
              </div>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(passwordResult)}
        onOpenChange={(open) => !open && setPasswordResult(null)}
      >
        <DialogContent className="admin-user-dialog admin-user-result-dialog">
          <DialogTitle>Temporary password</DialogTitle>
          {passwordResult ? (
            <PasswordResultPanel result={passwordResult} />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PasswordResultPanel({ result }: { result: PasswordResult }) {
  return (
    <div className="admin-user-result">
      <div className="split" style={{ alignItems: "start" }}>
        <div className="stack" style={{ gap: "8px" }}>
          <span className="muted">
            Copy now. This password is only shown in this response.
          </span>
        </div>
        <button
          className="button button-secondary"
          type="button"
          onClick={() =>
            copyText(
              `Email: ${result.email}\nTemporary password: ${result.temporaryPassword}\nSign in: ${result.signInUrl}`,
            )
          }
        >
          <Copy size={14} aria-hidden />
          Copy
        </button>
      </div>
      <dl className="admin-user-result-list">
        <div>
          <dt>Email</dt>
          <dd>{result.email}</dd>
        </div>
        <div>
          <dt>Password</dt>
          <dd>
            <code>{result.temporaryPassword}</code>
          </dd>
        </div>
        <div>
          <dt>Sign in</dt>
          <dd>{result.signInUrl}</dd>
        </div>
      </dl>
    </div>
  );
}
