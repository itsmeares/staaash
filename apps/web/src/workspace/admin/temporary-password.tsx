import { Copy } from "lucide-react";
import { type ReactElement, type ReactNode, useState } from "react";

import { Alert } from "@staaash/ui/components/alert";
import { Button } from "@staaash/ui/components/button";
import {
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
  DialogTrigger,
} from "@staaash/ui/components/dialog";
import { Switch } from "@staaash/ui/components/switch";
import { toastManager } from "@staaash/ui/components/toast";

import {
  SettingsCard,
  SettingsRow,
  SettingsText,
} from "@/components/settings-layout";
import { copyText } from "@/lib/clipboard";

/** Single sign-on, when the server has it set up. */
export type Sso = { name: string; passwordLogin: boolean };

/** A temporary password, or a one-time invite link for single sign-on. */
export type SignInDetails = {
  email: string;
  signInUrl: string;
  temporaryPassword?: string | null;
  inviteUrl?: string | null;
};

const detailRows = (details: SignInDetails) =>
  details.inviteUrl
    ? [
        ["Invite link", details.inviteUrl],
        ["Email", details.email],
      ]
    : [
        ["Sign in at", details.signInUrl],
        ["Email", details.email],
        ["Password", details.temporaryPassword ?? ""],
      ];

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

/** The password rows of invite and reset; left empty, Staaash makes one. */
export function TemporaryPasswordRows() {
  return (
    <>
      <SettingsRow htmlFor="temporary-password" label="Password">
        <SettingsText
          autoComplete="off"
          id="temporary-password"
          maxLength={128}
          minLength={12}
          name="temporaryPassword"
          placeholder="Leave empty to generate"
        />
      </SettingsRow>
      <SettingsRow
        htmlFor="require-password-change"
        label="Change it at first sign-in"
      >
        <Switch
          defaultChecked
          id="require-password-change"
          name="requirePasswordChange"
        />
      </SettingsRow>
    </>
  );
}

// The next screen shows the password, so it's typed once.
export const temporaryPasswordPayload = (form: FormData) => {
  const typed = formString(form.get("temporaryPassword"))?.trim();
  const requirePasswordChange = form.get("requirePasswordChange") === "on";
  return typed
    ? {
        generateTemporaryPassword: false,
        temporaryPassword: typed,
        confirmTemporaryPassword: typed,
        requirePasswordChange,
      }
    : { generateTemporaryPassword: true, requirePasswordChange };
};

/** Shown once, right after the server makes the password or the link. */
export function SignInDetailsDialog({
  result,
  onClose,
}: {
  result: SignInDetails | null;
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
              {detailRows(result).map(([label, value]) => (
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
              {result.inviteUrl
                ? "The link works once, for 7 days. Opening it connects their single sign-on account."
                : "The password is only shown now."}
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
                detailRows(result)
                  .map(([label, value]) => `${label}: ${value}`)
                  .join("\n"),
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

/**
 * A small admin form in a dialog, its rows in one card: closes when
 * `onSubmit` succeeds, shows its error when it throws.
 */
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
      <DialogPopup className="sm:max-w-lg">
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
          <DialogPanel className="grid gap-3">
            {error ? <Alert variant="error">{error}</Alert> : null}
            <SettingsCard>{children}</SettingsCard>
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
