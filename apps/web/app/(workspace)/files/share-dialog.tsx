"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy, Link2Off } from "lucide-react";
import { toast } from "@/components/ui/toast";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupInput } from "@/components/ui/input-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { confirmAction } from "@/components/confirm-dialog";
import type { ShareLinkSummary } from "@/server/sharing";
import type { ManagedShareView } from "@/server/sharing/mutation-response";

type DialogShare = {
  id: string;
  shareUrl: string;
  hasPassword: boolean;
  downloadDisabled: boolean;
  expiresAt: Date;
  revokedAt: Date | null;
  status: "active" | "expired" | "revoked";
};

function fromSummary(s: ShareLinkSummary): DialogShare {
  return {
    id: s.id,
    shareUrl: s.shareUrl,
    hasPassword: s.hasPassword,
    downloadDisabled: s.downloadDisabled,
    expiresAt: new Date(s.expiresAt),
    revokedAt: s.revokedAt ? new Date(s.revokedAt) : null,
    status: s.status as "active" | "expired" | "revoked",
  };
}

function fromMutation(
  share: ManagedShareView,
  fallbackShareUrl: string,
): DialogShare {
  return {
    id: share.id,
    shareUrl: share.shareUrl ?? fallbackShareUrl,
    hasPassword: share.hasPassword,
    downloadDisabled: share.downloadDisabled,
    expiresAt: new Date(share.expiresAt),
    revokedAt: share.revokedAt ? new Date(share.revokedAt) : null,
    status: share.status,
  };
}

function formatExpiry(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function toLocalDateString(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function toLocalTimeString(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ---------------------------------------------------------------------------

const EXPIRY_OPTIONS = [
  { value: "7", label: "In 7 days" },
  { value: "30", label: "In 30 days" },
  { value: "90", label: "In 90 days" },
  { value: "365", label: "In 1 year" },
  { value: "pick", label: "Pick a date" },
];

type ShareDialogProps = {
  /** Shown in the title. */
  name?: string;
  targetType: "file" | "folder";
  targetId: string;
  initialShare: ShareLinkSummary | null;
  onClose: () => void;
};

export function ShareDialog({
  name,
  targetType,
  targetId,
  initialShare,
  onClose,
}: ShareDialogProps) {
  const [dialogShare, setDialogShare] = useState<DialogShare | null>(() =>
    initialShare ? fromSummary(initialShare) : null,
  );
  const [isBusy, setIsBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [passwordValue, setPasswordValue] = useState("");
  const [showPasswordField, setShowPasswordField] = useState(false);
  const openerRef = useRef<HTMLElement | null>(null);

  // Custom expiry state — kept in sync with dialogShare.expiresAt
  const [customDate, setCustomDate] = useState("");
  const [customTime, setCustomTime] = useState("");

  useEffect(() => {
    const opener = document.activeElement;
    openerRef.current = opener instanceof HTMLElement ? opener : null;
  }, []);

  const closeAndRestoreFocus = () => {
    onClose();
    requestAnimationFrame(() => openerRef.current?.focus());
  };

  // Sync custom date/time when share changes
  useEffect(() => {
    if (dialogShare?.expiresAt) {
      setCustomDate(toLocalDateString(dialogShare.expiresAt));
      setCustomTime(toLocalTimeString(dialogShare.expiresAt));
    }
  }, [dialogShare?.id, dialogShare?.expiresAt.getTime()]);

  // ---------------------------------------------------------------------------
  // API helper
  // ---------------------------------------------------------------------------

  const callApi = async (
    url: string,
    body: Record<string, string>,
  ): Promise<ManagedShareView | null> => {
    setIsBusy(true);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { Accept: "application/json" },
        body: new URLSearchParams(body),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        share?: ManagedShareView;
      };
      if (!res.ok) {
        toast.error(data.error ?? "Something went wrong");
        return null;
      }
      return data.share ?? null;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
      return null;
    } finally {
      setIsBusy(false);
    }
  };

  const applyResult = (result: ManagedShareView, successMsg?: string) => {
    setDialogShare(fromMutation(result, dialogShare?.shareUrl ?? ""));
    if (successMsg) toast.success(successMsg);
  };

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  const createLink = async () => {
    const result = await callApi("/api/shares", {
      targetType,
      [targetType === "file" ? "fileId" : "folderId"]: targetId,
    });
    if (result) applyResult(result, "Link created");
  };

  const reissueLink = async () => {
    if (!dialogShare) return;
    const result = await callApi("/api/shares", {
      mode: "reissue",
      shareId: dialogShare.id,
    });
    if (result) applyResult(result, "Link reissued");
  };

  // Set expiry to N days from now
  const setExpiryPreset = async (days: number) => {
    if (!dialogShare) return;
    const newExpiry = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    const result = await callApi(`/api/shares/${dialogShare.id}/update`, {
      expiresAt: newExpiry.toISOString(),
      downloadDisabled: String(dialogShare.downloadDisabled),
    });
    if (result) applyResult(result, "Expiry updated");
  };

  const saveCustomExpiry = async () => {
    if (!dialogShare || !customDate) return;
    const combined = new Date(`${customDate}T${customTime || "00:00"}`);
    if (isNaN(combined.getTime()) || combined <= new Date()) {
      toast.error("Choose a future date and time");
      return;
    }
    const result = await callApi(`/api/shares/${dialogShare.id}/update`, {
      expiresAt: combined.toISOString(),
      downloadDisabled: String(dialogShare.downloadDisabled),
    });
    if (result) applyResult(result, "Expiry updated");
  };

  const toggleDownloads = async () => {
    if (!dialogShare) return;
    const newVal = !dialogShare.downloadDisabled;
    const result = await callApi(`/api/shares/${dialogShare.id}/update`, {
      expiresAt: dialogShare.expiresAt.toISOString(),
      downloadDisabled: String(newVal),
    });
    if (result) {
      applyResult(result);
      newVal
        ? toast.error("Downloads disabled")
        : toast.success("Downloads enabled");
    }
  };

  const handleSetPassword = async () => {
    if (!dialogShare || passwordValue.trim().length < 4) return;
    const result = await callApi(`/api/shares/${dialogShare.id}/password`, {
      password: passwordValue,
    });
    if (result) {
      applyResult(result, "Password set");
      setPasswordValue("");
      setShowPasswordField(false);
    }
  };

  const handleClearPassword = async () => {
    if (!dialogShare) return;
    const result = await callApi(`/api/shares/${dialogShare.id}/password`, {
      clear: "true",
    });
    if (result) {
      applyResult(result);
      toast.error("Password removed");
      setShowPasswordField(false);
    }
  };

  const revokeLink = async () => {
    if (!dialogShare) return;
    const result = await callApi(`/api/shares/${dialogShare.id}/revoke`, {});
    if (result) {
      applyResult(result);
      toast.error("Link revoked");
    }
  };

  const copyUrl = async () => {
    if (!dialogShare?.shareUrl) return;
    try {
      await navigator.clipboard.writeText(dialogShare.shareUrl);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = dialogShare.shareUrl;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(true);
    toast.success("Link copied");
    setTimeout(() => setCopied(false), 2000);
  };

  const isActive = dialogShare?.status === "active";
  const isInactive = dialogShare !== null && dialogShare.status !== "active";
  const [pickingDate, setPickingDate] = useState(false);
  const [passwordOn, setPasswordOn] = useState(false);

  const turnOff = async () => {
    const ok = await confirmAction({
      title: "Turn off this link?",
      description: "Anyone who has it can't open it any more.",
      confirmLabel: "Turn off",
      destructive: true,
    });
    if (ok) await revokeLink();
  };

  const row =
    "flex min-h-13 items-center gap-3 border-t border-border px-3.5 py-2 first:border-t-0";

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) closeAndRestoreFocus();
      }}
    >
      <DialogContent className="sm:max-w-110">
        <DialogHeader>
          <DialogTitle className="truncate pe-8">
            {name ? `Share "${name}"` : "Share"}
          </DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 px-6 pb-2">
          {!dialogShare ? (
            <Button onClick={createLink} disabled={isBusy}>
              {isBusy ? "Creating…" : "Create link"}
            </Button>
          ) : null}

          {isActive && dialogShare ? (
            <>
              <div className="flex items-center gap-2">
                <InputGroup className="min-w-0 flex-1">
                  <InputGroupInput
                    aria-label="Link"
                    className="text-muted-foreground"
                    readOnly
                    value={dialogShare.shareUrl}
                    onFocus={(event) => event.currentTarget.select()}
                  />
                </InputGroup>
                <Button onClick={copyUrl}>
                  {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
                  {copied ? "Copied" : "Copy link"}
                </Button>
              </div>

              <div className="overflow-hidden rounded-xl border border-border">
                <div className={row}>
                  <span className="grid flex-1 gap-0.5">
                    <span className="text-body font-medium">Expires</span>
                    <span className="text-label text-muted-foreground tabular-nums">
                      {formatExpiry(dialogShare.expiresAt)}
                    </span>
                  </span>
                  <Select
                    value={null}
                    onValueChange={(value) => {
                      if (value === "pick") setPickingDate(true);
                      else if (value) void setExpiryPreset(Number(value));
                    }}
                  >
                    <SelectTrigger
                      aria-label="Change expiry"
                      className="w-36"
                      size="sm"
                    >
                      <SelectValue placeholder="Change" />
                    </SelectTrigger>
                    <SelectContent align="end" alignItemWithTrigger={false}>
                      {EXPIRY_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {pickingDate ? (
                  <div className={row}>
                    <Input
                      aria-label="Expiry date"
                      className="min-w-0 flex-1"
                      disabled={isBusy}
                      size="sm"
                      type="date"
                      value={customDate}
                      onChange={(e) => setCustomDate(e.target.value)}
                    />
                    <Input
                      aria-label="Expiry time"
                      className="w-28 shrink-0"
                      disabled={isBusy}
                      size="sm"
                      type="time"
                      value={customTime}
                      onChange={(e) => setCustomTime(e.target.value)}
                    />
                    <Button
                      disabled={isBusy || !customDate}
                      size="sm"
                      variant="outline"
                      onClick={async () => {
                        await saveCustomExpiry();
                        setPickingDate(false);
                      }}
                    >
                      Set
                    </Button>
                  </div>
                ) : null}
                <label className={row}>
                  <span className="flex-1 text-body font-medium">
                    Allow downloads
                  </span>
                  <Switch
                    checked={!dialogShare.downloadDisabled}
                    disabled={isBusy}
                    onCheckedChange={toggleDownloads}
                  />
                </label>
                <label className={row}>
                  <span className="flex-1 text-body font-medium">Password</span>
                  <Switch
                    checked={dialogShare.hasPassword || passwordOn}
                    disabled={isBusy}
                    onCheckedChange={(on) => {
                      if (on) setPasswordOn(true);
                      else {
                        setPasswordOn(false);
                        if (dialogShare.hasPassword) void handleClearPassword();
                      }
                    }}
                  />
                </label>
                {passwordOn ||
                (dialogShare.hasPassword && showPasswordField) ? (
                  <div className={row}>
                    <Input
                      autoComplete="new-password"
                      autoFocus
                      className="flex-1"
                      disabled={isBusy}
                      placeholder="At least 4 characters"
                      size="sm"
                      type="password"
                      value={passwordValue}
                      onChange={(e) => setPasswordValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          void handleSetPassword().then(() =>
                            setPasswordOn(false),
                          );
                        }
                      }}
                    />
                    <Button
                      disabled={isBusy || passwordValue.trim().length < 4}
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        void handleSetPassword().then(() =>
                          setPasswordOn(false),
                        )
                      }
                    >
                      Set
                    </Button>
                  </div>
                ) : dialogShare.hasPassword ? (
                  <div className={row}>
                    <span className="flex-1 text-label text-muted-foreground">
                      Visitors need the password to open it.
                    </span>
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => setShowPasswordField(true)}
                    >
                      Change
                    </Button>
                  </div>
                ) : null}
              </div>
            </>
          ) : null}

          {isInactive && dialogShare ? (
            <div className="grid gap-3">
              <p className="m-0 text-body text-muted-foreground">
                {dialogShare.status === "revoked"
                  ? "This link is turned off."
                  : "This link has expired."}
              </p>
              <Button onClick={reissueLink} disabled={isBusy}>
                {isBusy ? "Making a new link…" : "Make a new link"}
              </Button>
            </div>
          ) : null}
        </div>

        <DialogFooter variant="bare">
          {isActive ? (
            <Button
              className="sm:me-auto"
              variant="ghost-destructive"
              onClick={() => void turnOff()}
            >
              <Link2Off aria-hidden />
              Turn off link
            </Button>
          ) : null}
          <Button variant="outline" onClick={closeAndRestoreFocus}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
