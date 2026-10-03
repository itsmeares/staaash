"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState, useTransition } from "react";
import { Copy, Edit2, KeyRound } from "lucide-react";

import { AdminToggleField } from "@/app/admin/admin-toggle-field";
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
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

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
    <div className="flex flex-wrap items-start justify-end gap-2 max-md:justify-start">
      {error ? (
        <span className="text-label text-destructive-foreground">{error}</span>
      ) : null}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogTrigger render={<Button variant="secondary" />}>
          <Edit2 aria-hidden />
          Edit
        </DialogTrigger>
        <DialogPopup className="max-w-110">
          <form className="flex min-h-0 flex-col" onSubmit={handleEdit}>
            <DialogHeader>
              <DialogTitle>Edit user</DialogTitle>
            </DialogHeader>
            <DialogPanel className="grid grid-cols-1 gap-4">
              <Field>
                <FieldLabel>Email</FieldLabel>
                <Input
                  name="email"
                  type="email"
                  defaultValue={user.email}
                  required
                />
              </Field>
              <Field>
                <FieldLabel>Name</FieldLabel>
                <Input
                  name="displayName"
                  defaultValue={user.displayName ?? ""}
                />
              </Field>
              <Field>
                <FieldLabel>Quota size (GiB)</FieldLabel>
                <Input
                  name="quotaGiB"
                  type="number"
                  min={1}
                  step={1}
                  defaultValue={toGibInput(user.storageLimitBytes)}
                  disabled={quotaUnlimited}
                  placeholder="Unlimited"
                />
              </Field>
              <AdminToggleField
                checked={quotaUnlimited}
                label="Unlimited"
                onChange={setQuotaUnlimited}
              />
              <AdminToggleField
                name="isAdmin"
                defaultChecked={user.isAdmin}
                disabled={user.isOwner}
                label="Admin user"
              />
            </DialogPanel>
            <DialogFooter>
              <Button variant="secondary" onClick={() => setEditOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={isRefreshing}>
                Save changes
              </Button>
            </DialogFooter>
          </form>
        </DialogPopup>
      </Dialog>

      <Dialog open={resetOpen} onOpenChange={setResetOpen}>
        <DialogTrigger render={<Button variant="secondary" />}>
          <KeyRound aria-hidden />
          Reset password
        </DialogTrigger>
        <DialogPopup className="max-w-110">
          <form className="flex min-h-0 flex-col" onSubmit={handleReset}>
            <DialogHeader>
              <DialogTitle>Reset password</DialogTitle>
            </DialogHeader>
            <DialogPanel className="grid grid-cols-1 gap-4">
              <p className="m-0 text-meta text-muted-foreground">
                Existing sessions are revoked immediately.
              </p>
              <AdminToggleField
                checked={generated}
                label="Generate temporary password"
                onChange={setGenerated}
              />
              {!generated ? (
                <>
                  <Field>
                    <FieldLabel>Temporary password</FieldLabel>
                    <Input
                      name="temporaryPassword"
                      type="password"
                      minLength={12}
                    />
                  </Field>
                  <Field>
                    <FieldLabel>Confirm temporary password</FieldLabel>
                    <Input
                      name="confirmTemporaryPassword"
                      type="password"
                      minLength={12}
                    />
                  </Field>
                </>
              ) : null}
              <AdminToggleField
                name="requirePasswordChange"
                defaultChecked
                label="Require password change on next login"
              />
              {password ? (
                <div className="grid grid-cols-1 gap-4">
                  <strong>Temporary password</strong>
                  <code>{password}</code>
                  <Button
                    className="justify-self-start"
                    variant="secondary"
                    onClick={() =>
                      navigator.clipboard.writeText(
                        `Email: ${user.email}\nTemporary password: ${password}\nSign in: ${signInUrl}`,
                      )
                    }
                  >
                    <Copy aria-hidden />
                    Copy
                  </Button>
                </div>
              ) : null}
            </DialogPanel>
            <DialogFooter>
              <Button variant="secondary" onClick={() => setResetOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={isRefreshing}>
                Reset password
              </Button>
            </DialogFooter>
          </form>
        </DialogPopup>
      </Dialog>
    </div>
  );
}
