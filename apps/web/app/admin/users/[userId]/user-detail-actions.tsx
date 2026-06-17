"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState, useTransition } from "react";
import { Copy, Edit2, KeyRound } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

type DetailUser = {
  id: string;
  email: string;
  displayName: string | null;
  isOwner: boolean;
  isAdmin: boolean;
  storageLimitBytes: string | null;
};

type UserDetailActionsProps = {
  user: DetailUser;
  canMutate: boolean;
  signInUrl: string;
};

const BYTES_PER_GIB = 1024n * 1024n * 1024n;

const toGibInput = (bytes: string | null) =>
  bytes ? (BigInt(bytes) / BYTES_PER_GIB).toString() : "";

const fromGibInput = (value: string, unlimited: boolean) =>
  unlimited || value.trim() === ""
    ? null
    : (BigInt(value) * BYTES_PER_GIB).toString();

export function UserDetailActions({
  user,
  canMutate,
  signInUrl,
}: UserDetailActionsProps) {
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [quotaUnlimited, setQuotaUnlimited] = useState(!user.storageLimitBytes);
  const [generated, setGenerated] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState<string | null>(null);
  const [isRefreshing, startTransition] = useTransition();

  if (!canMutate) return null;

  const parseError = async (response: Response) => {
    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    return body.error ?? "Request failed.";
  };

  const refresh = () => startTransition(() => router.refresh());

  async function handleEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const form = new FormData(event.currentTarget);
    const response = await fetch(`/api/admin/users/${user.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        email: String(form.get("email") ?? ""),
        displayName: String(form.get("displayName") ?? ""),
        storageLimitBytes: fromGibInput(
          String(form.get("quotaGiB") ?? ""),
          quotaUnlimited,
        ),
        isAdmin: user.isOwner ? true : form.get("isAdmin") === "on",
      }),
    });

    if (!response.ok) {
      setError(await parseError(response));
      return;
    }

    setEditOpen(false);
    refresh();
  }

  async function handleReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPassword(null);

    const form = new FormData(event.currentTarget);
    const response = await fetch(`/api/admin/users/${user.id}/password-reset`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        generateTemporaryPassword: generated,
        temporaryPassword: form.get("temporaryPassword"),
        confirmTemporaryPassword: form.get("confirmTemporaryPassword"),
        requirePasswordChange: form.get("requirePasswordChange") === "on",
      }),
    });

    if (!response.ok) {
      setError(await parseError(response));
      return;
    }

    const body = (await response.json()) as { temporaryPassword: string };
    setPassword(body.temporaryPassword);
    refresh();
  }

  return (
    <div className="admin-detail-actions">
      {error ? (
        <span className="settings-form-status-error">{error}</span>
      ) : null}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogTrigger className="button button-secondary">
          <Edit2 size={14} aria-hidden />
          Edit
        </DialogTrigger>
        <DialogContent className="admin-user-dialog">
          <DialogTitle>Edit user</DialogTitle>
          <form className="form-grid" onSubmit={handleEdit}>
            <label className="field">
              <span>Email</span>
              <input
                name="email"
                type="email"
                defaultValue={user.email}
                required
              />
            </label>
            <label className="field">
              <span>Name</span>
              <input name="displayName" defaultValue={user.displayName ?? ""} />
            </label>
            <div className="admin-user-dialog-grid">
              <label className="field">
                <span>Quota size (GiB)</span>
                <input
                  name="quotaGiB"
                  type="number"
                  min={1}
                  step={1}
                  defaultValue={toGibInput(user.storageLimitBytes)}
                  disabled={quotaUnlimited}
                  placeholder="Unlimited"
                />
              </label>
              <label className="admin-user-checkbox">
                <input
                  type="checkbox"
                  checked={quotaUnlimited}
                  onChange={(event) =>
                    setQuotaUnlimited(event.currentTarget.checked)
                  }
                />
                <span>Unlimited</span>
              </label>
            </div>
            <label className="admin-user-checkbox">
              <input
                name="isAdmin"
                type="checkbox"
                defaultChecked={user.isAdmin}
                disabled={user.isOwner}
              />
              <span>Admin user</span>
            </label>
            <div className="admin-user-dialog-actions">
              <button
                type="button"
                className="button button-secondary"
                onClick={() => setEditOpen(false)}
              >
                Cancel
              </button>
              <button type="submit" className="button" disabled={isRefreshing}>
                Save changes
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={resetOpen} onOpenChange={setResetOpen}>
        <DialogTrigger className="button button-secondary">
          <KeyRound size={14} aria-hidden />
          Reset password
        </DialogTrigger>
        <DialogContent className="admin-user-dialog">
          <DialogTitle>Reset password</DialogTitle>
          <form className="form-grid" onSubmit={handleReset}>
            <p className="muted">Existing sessions are revoked immediately.</p>
            <label className="admin-user-checkbox">
              <input
                type="checkbox"
                checked={generated}
                onChange={(event) => setGenerated(event.currentTarget.checked)}
              />
              <span>Generate temporary password</span>
            </label>
            {!generated ? (
              <>
                <label className="field">
                  <span>Temporary password</span>
                  <input
                    name="temporaryPassword"
                    type="password"
                    minLength={12}
                  />
                </label>
                <label className="field">
                  <span>Confirm temporary password</span>
                  <input
                    name="confirmTemporaryPassword"
                    type="password"
                    minLength={12}
                  />
                </label>
              </>
            ) : null}
            <label className="admin-user-checkbox">
              <input
                name="requirePasswordChange"
                type="checkbox"
                defaultChecked
              />
              <span>Require password change on next login</span>
            </label>
            <div className="admin-user-dialog-actions">
              <button
                type="button"
                className="button button-secondary"
                onClick={() => setResetOpen(false)}
              >
                Cancel
              </button>
              <button type="submit" className="button" disabled={isRefreshing}>
                Reset password
              </button>
            </div>
          </form>
          {password ? (
            <div className="admin-user-result">
              <strong>Temporary password</strong>
              <code>{password}</code>
              <button
                className="button button-secondary"
                type="button"
                onClick={() =>
                  navigator.clipboard.writeText(
                    `Email: ${user.email}\nTemporary password: ${password}\nSign in: ${signInUrl}`,
                  )
                }
              >
                <Copy size={14} aria-hidden />
                Copy
              </button>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
