"use client";

import { Copy } from "lucide-react";
import { type ReactElement, type ReactNode, useState } from "react";

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
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { toastManager } from "@/components/ui/toast";

import { AdminToggleField } from "./admin-toggle-field";
import { copyText } from "@/lib/clipboard";

export type TemporaryPassword = {
  email: string;
  temporaryPassword: string;
  signInUrl: string;
};

/** JSON to an admin route; the server's error message on failure. */
export const sendAdmin = async <T,>(
  url: string,
  method: "POST" | "PATCH" | "DELETE",
  body?: unknown,
) => {
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as T & {
    error?: string;
  };
  if (!response.ok) throw new Error(data.error ?? "Request failed.");
  return data;
};

const formString = (value: FormDataEntryValue | null) =>
  typeof value === "string" ? value : undefined;

/** The password half of invite and reset: generated, or typed twice. */
export function TemporaryPasswordFields() {
  const [generated, setGenerated] = useState(true);
  return (
    <>
      <AdminToggleField
        checked={generated}
        label="Make up a password for me"
        onChange={setGenerated}
      />
      <input name="generate" type="hidden" value={generated ? "on" : ""} />
      {generated ? null : (
        <>
          <Field>
            <FieldLabel>Temporary password</FieldLabel>
            <Input
              minLength={12}
              name="temporaryPassword"
              placeholder="12+ characters"
              required
              type="password"
            />
          </Field>
          <Field>
            <FieldLabel>Repeat it</FieldLabel>
            <Input
              minLength={12}
              name="confirmTemporaryPassword"
              required
              type="password"
            />
          </Field>
        </>
      )}
      <AdminToggleField
        defaultChecked
        label="Ask for a new password at sign-in"
        name="requirePasswordChange"
      />
    </>
  );
}

export const temporaryPasswordPayload = (form: FormData) =>
  form.get("generate") === "on"
    ? {
        generateTemporaryPassword: true,
        requirePasswordChange: form.get("requirePasswordChange") === "on",
      }
    : {
        generateTemporaryPassword: false,
        temporaryPassword: formString(form.get("temporaryPassword")),
        confirmTemporaryPassword: formString(
          form.get("confirmTemporaryPassword"),
        ),
        requirePasswordChange: form.get("requirePasswordChange") === "on",
      };

/** Shown once, right after the server makes the password. */
export function TemporaryPasswordDialog({
  result,
  onClose,
}: {
  result: TemporaryPassword | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={Boolean(result)} onOpenChange={(open) => !open && onClose()}>
      <DialogPopup className="max-w-110">
        <DialogHeader>
          <DialogTitle>Send these to {result?.email}</DialogTitle>
        </DialogHeader>
        {result ? (
          <DialogPanel className="grid gap-2">
            <dl className="m-0 grid gap-2 rounded-xl bg-hover/60 p-3.5 text-body">
              {[
                ["Sign in at", result.signInUrl],
                ["Email", result.email],
                ["Password", result.temporaryPassword],
              ].map(([label, value]) => (
                <div
                  className="grid grid-cols-[6rem_minmax(0,1fr)] gap-3"
                  key={label}
                >
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="m-0 font-mono wrap-anywhere">{value}</dd>
                </div>
              ))}
            </dl>
            <p className="m-0 text-label text-muted-foreground">
              The password is only shown now.
            </p>
          </DialogPanel>
        ) : null}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Done
          </Button>
          <Button
            onClick={async () => {
              if (!result) return;
              await copyText(
                `Sign in at: ${result.signInUrl}\nEmail: ${result.email}\nPassword: ${result.temporaryPassword}`,
              );
              toastManager.add({
                title: "Copied",
                type: "success",
                timeout: 1500,
              });
            }}
          >
            <Copy aria-hidden />
            Copy all
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

/** A small admin form in a dialog: closes when `onSubmit` succeeds, shows its error when it throws. */
export function AdminFormDialog({
  trigger,
  triggerLabel,
  title,
  submitLabel,
  onSubmit,
  children,
}: {
  trigger: ReactElement;
  triggerLabel: ReactNode;
  title: string;
  submitLabel: string;
  onSubmit: (form: FormData) => Promise<void>;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setError(null);
      }}
    >
      <DialogTrigger render={trigger}>{triggerLabel}</DialogTrigger>
      <DialogPopup className="max-w-110">
        <form
          className="flex min-h-0 flex-col"
          onSubmit={async (event) => {
            event.preventDefault();
            setError(null);
            try {
              await onSubmit(new FormData(event.currentTarget));
              setOpen(false);
            } catch (caught) {
              setError(
                caught instanceof Error ? caught.message : "Request failed.",
              );
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          <DialogPanel className="grid gap-4">
            {children}
            {error ? <Alert variant="error">{error}</Alert> : null}
          </DialogPanel>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit">{submitLabel}</Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
