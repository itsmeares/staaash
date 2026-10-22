"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { DeviceList } from "@/components/device-list";
import type { Device } from "@/lib/user-agent";
import {
  BYTES,
  SettingsCard,
  SettingsRow,
  SettingsText,
  UnitField,
} from "@/components/settings-layout";
import { Alert } from "@staaash/ui/components/alert";
import { Badge } from "@staaash/ui/components/badge";
import { Button } from "@staaash/ui/components/button";
import { toastManager } from "@staaash/ui/components/toast";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@staaash/ui/components/toggle-group";
import { formatBytes } from "@/lib/format-bytes";

import {
  AdminFormDialog,
  sendAdmin,
  type TemporaryPassword,
  TemporaryPasswordDialog,
  TemporaryPasswordFields,
  temporaryPasswordPayload,
} from "../../temporary-password";

type Account = {
  id: string;
  email: string;
  displayName: string | null;
  isOwner: boolean;
  isAdmin: boolean;
  /** Bytes, or "" for no limit. */
  storageLimitBytes: string;
};

/** What admins who can't edit see. */
function AccountFacts({ account }: { account: Account }) {
  return (
    <SettingsCard>
      <SettingsRow label="Name">{account.displayName ?? "None"}</SettingsRow>
      <SettingsRow label="Email">{account.email}</SettingsRow>
      <SettingsRow label="Storage limit">
        {account.storageLimitBytes
          ? formatBytes(BigInt(account.storageLimitBytes))
          : "No limit"}
      </SettingsRow>
    </SettingsCard>
  );
}

/** Name, email, role and limit; each saves when it changes. */
export function AccountCard({
  account,
  canEdit,
}: {
  account: Account;
  canEdit: boolean;
}) {
  return canEdit ? (
    <AccountEditor account={account} />
  ) : (
    <AccountFacts account={account} />
  );
}

function AccountEditor({ account }: { account: Account }) {
  const router = useRouter();
  const [values, setValues] = useState(account);
  const [error, setError] = useState<string | null>(null);
  // The unit menu commits in the same event that changes the value.
  const limit = useRef(account.storageLimitBytes);

  const save = async (next: Account) => {
    setValues(next);
    setError(null);
    try {
      await sendAdmin(`/api/admin/users/${account.id}`, "PATCH", {
        email: next.email,
        displayName: next.displayName ?? "",
        storageLimitBytes: next.storageLimitBytes || null,
        isAdmin: next.isOwner || next.isAdmin,
      });
      toastManager.add({ title: "Saved", type: "success", timeout: 1500 });
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save.");
    }
  };
  const saveIfChanged = (next: Account) => {
    if (JSON.stringify(next) !== JSON.stringify(account)) void save(next);
  };

  return (
    <SettingsCard>
      {error ? (
        <Alert className="m-3" variant="error">
          {error}
        </Alert>
      ) : null}
      <SettingsRow htmlFor="user-name" label="Name">
        <SettingsText
          id="user-name"
          placeholder="Their name"
          value={values.displayName ?? ""}
          onBlur={() => saveIfChanged(values)}
          onChange={(event) =>
            setValues({ ...values, displayName: event.target.value || null })
          }
        />
      </SettingsRow>
      <SettingsRow htmlFor="user-email" label="Email">
        <SettingsText
          id="user-email"
          type="email"
          value={values.email}
          onBlur={() => saveIfChanged(values)}
          onChange={(event) =>
            setValues({ ...values, email: event.target.value })
          }
        />
      </SettingsRow>
      <SettingsRow
        hint={values.isOwner ? undefined : "Admins can open these pages"}
        label="Role"
      >
        {values.isOwner ? (
          <Badge variant="accent">Owner</Badge>
        ) : (
          <ToggleGroup
            aria-label="Role"
            size="sm"
            value={[values.isAdmin ? "admin" : "member"]}
            variant="outline"
            onValueChange={(next) => {
              const role = next[0];
              if (role) void save({ ...values, isAdmin: role === "admin" });
            }}
          >
            <ToggleGroupItem value="member">Member</ToggleGroupItem>
            <ToggleGroupItem value="admin">Admin</ToggleGroupItem>
          </ToggleGroup>
        )}
      </SettingsRow>
      <SettingsRow htmlFor="user-limit" label="Storage limit">
        <UnitField
          emptyUnit="GB"
          id="user-limit"
          name="storageLimitBytes"
          placeholder="No limit"
          units={BYTES}
          value={values.storageLimitBytes}
          onChange={(next) => {
            limit.current = next;
            setValues({ ...values, storageLimitBytes: next });
          }}
          onCommit={() =>
            saveIfChanged({ ...values, storageLimitBytes: limit.current })
          }
        />
      </SettingsRow>
    </SettingsCard>
  );
}

/** Reset password (with the result shown once) and their devices. */
export function SignInCard({
  userId,
  signInUrl,
  devices,
  canEdit,
}: {
  userId: string;
  signInUrl: string;
  devices: Device[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [result, setResult] = useState<TemporaryPassword | null>(null);

  const reset = async (form: FormData) => {
    const body = await sendAdmin<{
      user: { email: string };
      temporaryPassword: string;
    }>(
      `/api/admin/users/${userId}/password-reset`,
      "POST",
      temporaryPasswordPayload(form),
    );
    setResult({
      email: body.user.email,
      temporaryPassword: body.temporaryPassword,
      signInUrl,
    });
    router.refresh();
  };

  return (
    <div className="grid gap-3">
      {canEdit ? (
        <SettingsCard>
          <SettingsRow hint="Signs them out everywhere" label="Password">
            <AdminFormDialog
              submitLabel="Reset password"
              title="Reset password"
              trigger={<Button size="sm" variant="outline" />}
              triggerLabel="Reset password"
              onSubmit={reset}
            >
              <TemporaryPasswordFields />
            </AdminFormDialog>
          </SettingsRow>
        </SettingsCard>
      ) : null}
      <DeviceList
        devices={devices}
        hideAddresses
        onSignOut={
          canEdit
            ? async (sessionId) => {
                await sendAdmin(
                  `/api/admin/users/${userId}/sessions/${sessionId}`,
                  "DELETE",
                );
                toastManager.add({
                  title: "Signed out",
                  type: "success",
                  timeout: 1500,
                });
              }
            : undefined
        }
      />
      <TemporaryPasswordDialog
        result={result}
        onClose={() => setResult(null)}
      />
    </div>
  );
}
