import { useRefresh } from "@/lib/use-refresh";
import { useRef, useState } from "react";

import { confirmAction } from "@/components/confirm-dialog";
import { DeviceList } from "@/components/device-list";
import { KeyList } from "@/components/key-list";
import type { Device } from "@/lib/user-agent";
import type { KeyView } from "@/server/auth/keys";
import {
  BYTES,
  SettingsCard,
  SettingsGroup,
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
  type SignInDetails,
  SignInDetailsDialog,
  type Sso,
  TemporaryPasswordFields,
  temporaryPasswordPayload,
} from "./temporary-password";

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
  const refresh = useRefresh();
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
      void refresh();
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

/** Their single sign-on link: disconnect it, or send a new invite link. */
function SsoRow({
  sso,
  userId,
  linked,
  signInUrl,
  onInvite,
}: {
  sso: Sso;
  userId: string;
  linked: boolean;
  signInUrl: string;
  onInvite: (details: SignInDetails) => void;
}) {
  const refresh = useRefresh();
  const act = async (run: () => Promise<void>) => {
    try {
      await run();
      void refresh();
    } catch (caught) {
      toastManager.add({
        title: caught instanceof Error ? caught.message : "Request failed.",
        type: "error",
      });
    }
  };
  const disconnect = () =>
    act(async () => {
      const ok = await confirmAction({
        title: `Disconnect from ${sso.name}?`,
        description:
          "They can't sign in with it until you send a new invite link.",
        confirmLabel: "Disconnect",
        destructive: true,
      });
      if (!ok) return;
      await sendAdmin(`/api/admin/users/${userId}/oidc-disconnect`, "POST");
      toastManager.add({ title: "Disconnected", type: "success" });
    });
  const invite = () =>
    act(async () => {
      const body = await sendAdmin<{ email: string; inviteUrl: string }>(
        `/api/admin/users/${userId}/oidc-invite`,
        "POST",
      );
      onInvite({ email: body.email, inviteUrl: body.inviteUrl, signInUrl });
    });

  return (
    <SettingsRow
      hint={linked ? "Connected" : "Not connected yet"}
      label={sso.name}
    >
      {linked ? (
        <Button size="sm" variant="outline" onClick={() => void disconnect()}>
          Disconnect
        </Button>
      ) : (
        <Button size="sm" variant="outline" onClick={() => void invite()}>
          New invite link
        </Button>
      )}
    </SettingsRow>
  );
}

function PasswordResetRow({
  userId,
  signInUrl,
  onReset,
}: {
  userId: string;
  signInUrl: string;
  onReset: (details: SignInDetails) => void;
}) {
  const refresh = useRefresh();
  const reset = async (form: FormData) => {
    const body = await sendAdmin<{
      user: { email: string };
      temporaryPassword: string;
    }>(
      `/api/admin/users/${userId}/password-reset`,
      "POST",
      temporaryPasswordPayload(form),
    );
    onReset({
      email: body.user.email,
      temporaryPassword: body.temporaryPassword,
      signInUrl,
    });
    void refresh();
  };

  return (
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
  );
}

/** A member's keys, which the owner can delete but never see or make. */
function MemberKeys({
  userId,
  keys,
  canEdit,
}: {
  userId: string;
  keys: KeyView[];
  canEdit: boolean;
}) {
  if (keys.length === 0) return null;
  const remove = async (sessionId: string) => {
    await sendAdmin(
      `/api/admin/users/${userId}/sessions/${sessionId}`,
      "DELETE",
    );
  };
  return (
    <SettingsGroup title="Keys">
      <KeyList keys={keys} onDelete={canEdit ? remove : undefined} />
    </SettingsGroup>
  );
}

/** Reset password (with the result shown once), their devices, and their keys. */
export function SignInCard({
  userId,
  signInUrl,
  devices,
  keys,
  canEdit,
  sso,
  oidcLinked,
}: {
  userId: string;
  signInUrl: string;
  devices: Device[];
  keys: KeyView[];
  canEdit: boolean;
  sso: Sso | null;
  oidcLinked: boolean;
}) {
  const [result, setResult] = useState<SignInDetails | null>(null);
  // With passwords off, there is nothing to reset.
  const passwords = sso?.passwordLogin ?? true;

  return (
    <div className="grid gap-3">
      {canEdit ? (
        <SettingsCard>
          {sso ? (
            <SsoRow
              linked={oidcLinked}
              signInUrl={signInUrl}
              sso={sso}
              userId={userId}
              onInvite={setResult}
            />
          ) : null}
          {passwords ? (
            <PasswordResetRow
              signInUrl={signInUrl}
              userId={userId}
              onReset={setResult}
            />
          ) : null}
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
      <MemberKeys canEdit={canEdit} keys={keys} userId={userId} />
      <SignInDetailsDialog result={result} onClose={() => setResult(null)} />
    </div>
  );
}
