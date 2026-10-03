"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy, Link2Off, Lock, LockOpen, Download } from "lucide-react";
import { toast } from "@/components/ui/toast";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupInput } from "@/components/ui/input-group";
import { Switch } from "@/components/ui/switch";
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

type ShareDialogProps = {
  targetType: "file" | "folder";
  targetId: string;
  initialShare: ShareLinkSummary | null;
  onClose: () => void;
};

export function ShareDialog({
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

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) closeAndRestoreFocus();
      }}
    >
      <DialogContent className="max-w-105">
        <DialogHeader className="border-b border-hairline px-5 pt-4 pb-3">
          <DialogTitle className="text-label font-semibold">Share</DialogTitle>
        </DialogHeader>

        <div className="grid">
          {!dialogShare && (
            <div className="grid gap-3.5 px-5 py-5">
              <p className="text-label leading-normal text-muted-foreground">
                No public link for this {targetType}.
              </p>
              <Button size="sm" onClick={createLink} disabled={isBusy}>
                {isBusy ? "Creating…" : "Create share link"}
              </Button>
            </div>
          )}

          {isActive && dialogShare && (
            <>
              <div className="grid gap-2.5 border-b border-hairline px-5 py-3.5">
                <div className="flex items-center gap-2">
                  <InputGroup className="min-w-0 flex-1">
                    <InputGroupInput
                      className="font-mono text-xs text-muted-foreground"
                      value={dialogShare.shareUrl}
                      readOnly
                      aria-label="Share URL"
                    />
                  </InputGroup>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={copyUrl}
                    aria-label="Copy link"
                  >
                    {copied ? <Check /> : <Copy />}
                    {copied ? "Copied" : "Copy"}
                  </Button>
                </div>
              </div>

              <div className="grid gap-2.5 border-b border-hairline px-5 py-3.5">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-xs font-bold tracking-wider text-muted-foreground uppercase">
                    Expires
                  </p>
                  <span className="text-xs font-medium text-foreground tabular-nums">
                    {formatExpiry(dialogShare.expiresAt)}
                  </span>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {[
                    { label: "7 days", days: 7 },
                    { label: "30 days", days: 30 },
                    { label: "90 days", days: 90 },
                    { label: "1 year", days: 365 },
                  ].map(({ label, days }) => (
                    <Button
                      key={days}
                      type="button"
                      variant="outline"
                      size="xs"
                      onClick={() => setExpiryPreset(days)}
                      disabled={isBusy}
                    >
                      {label}
                    </Button>
                  ))}
                </div>

                <div className="flex items-center gap-1.5">
                  <Input
                    type="date"
                    size="sm"
                    className="min-w-0 flex-1"
                    value={customDate}
                    onChange={(e) => setCustomDate(e.target.value)}
                    disabled={isBusy}
                    aria-label="Expiry date"
                  />
                  <Input
                    type="time"
                    size="sm"
                    className="w-28 shrink-0"
                    value={customTime}
                    onChange={(e) => setCustomTime(e.target.value)}
                    disabled={isBusy}
                    aria-label="Expiry time"
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={saveCustomExpiry}
                    disabled={isBusy || !customDate}
                  >
                    Save
                  </Button>
                </div>
              </div>

              <div className="grid gap-2.5 border-b border-hairline px-5 py-3.5">
                <p className="text-xs font-bold tracking-wider text-muted-foreground uppercase">
                  Settings
                </p>

                <label className="flex cursor-pointer items-center gap-2 select-none">
                  <Switch
                    checked={!dialogShare.downloadDisabled}
                    onCheckedChange={toggleDownloads}
                    disabled={isBusy}
                  />
                  <Download
                    size={13}
                    className="shrink-0 text-muted-foreground"
                    aria-hidden
                  />
                  <span className="text-label text-foreground">
                    Allow downloads
                  </span>
                </label>

                <div className="grid gap-2">
                  <div className="flex items-center gap-2">
                    <Lock
                      size={13}
                      className="shrink-0 text-muted-foreground"
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1 text-label text-muted-foreground">
                      {dialogShare.hasPassword
                        ? "Password protected"
                        : "No password"}
                    </span>
                    <div className="flex shrink-0 gap-1.5">
                      {dialogShare.hasPassword && (
                        <Button
                          type="button"
                          variant="destructive-outline"
                          size="xs"
                          onClick={handleClearPassword}
                          disabled={isBusy}
                        >
                          Remove
                        </Button>
                      )}
                      <Button
                        type="button"
                        variant="outline"
                        size="xs"
                        onClick={() => setShowPasswordField((v) => !v)}
                      >
                        {showPasswordField
                          ? "Cancel"
                          : dialogShare.hasPassword
                            ? "Change"
                            : "Set"}
                      </Button>
                    </div>
                  </div>
                  {showPasswordField && (
                    <div className="flex items-center gap-2">
                      <Input
                        type="password"
                        size="sm"
                        className="flex-1"
                        placeholder="Min 4 characters"
                        value={passwordValue}
                        onChange={(e) => setPasswordValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleSetPassword();
                        }}
                        disabled={isBusy}
                        autoComplete="new-password"
                        autoFocus
                      />
                      <Button
                        type="button"
                        variant="secondary"
                        size="xs"
                        onClick={handleSetPassword}
                        disabled={isBusy || passwordValue.trim().length < 4}
                      >
                        {dialogShare.hasPassword ? "Update" : "Set"}
                      </Button>
                    </div>
                  )}
                </div>
              </div>

              <div className="px-5 py-3">
                <Button
                  type="button"
                  variant="destructive-outline"
                  className="w-full"
                  onClick={revokeLink}
                  disabled={isBusy}
                >
                  <Link2Off aria-hidden />
                  Revoke link
                </Button>
              </div>
            </>
          )}

          {isInactive && dialogShare && (
            <div className="grid gap-3.5 px-5 py-5">
              <p className="text-label leading-normal text-muted-foreground">
                This link is{" "}
                <strong className="font-semibold text-foreground">
                  {dialogShare.status === "revoked" ? "revoked" : "expired"}
                </strong>
                .
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={reissueLink}
                disabled={isBusy}
              >
                {isBusy ? "Reissuing…" : "Reissue link"}
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
