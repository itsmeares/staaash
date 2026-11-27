import { useRefresh } from "@/lib/use-refresh";
import { useState, type ReactNode } from "react";

import { confirmAction } from "@/components/confirm-dialog";
import { DeviceList } from "@/components/device-list";
import { KeyList } from "@/components/key-list";
import type { Device } from "@/lib/user-agent";
import type { KeyView } from "@/server/auth/keys";
import {
  SaveBar,
  SettingsCard,
  SettingsRow,
  SettingsText,
} from "@/components/settings-layout";
import { BYTES, UnitField } from "@staaash/ui/components/unit-field";
import { Alert } from "@staaash/ui/components/alert";
import { Badge } from "@staaash/ui/components/badge";
import { Button } from "@staaash/ui/components/button";
import { toastManager } from "@staaash/ui/components/toast";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@staaash/ui/components/toggle-group";

import { AdminGroup } from "./admin-panel";
import {
  AdminFormDialog,
  sendAdmin,
  type SignInDetails,
  SignInDetailsDialog,
  type Sso,
  TemporaryPasswordRows,
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
    </SettingsCard>
  );
}

/**
 * Name, email, role and storage limit, saved together with the same Save and
 * Discard bar as Settings. `children` are extra rows that act on their own;
 * `below` sits under the card, above the bar.
 */
export function AccountCard({
  account,
  canEdit,
  children,
  below,
}: {
  account: Account;
  canEdit: boolean;
  children?: ReactNode;
  below?: ReactNode;
}) {
  return canEdit ? (
    <AccountEditor account={account} below={below} key={account.id}>
      {children}
    </AccountEditor>
  ) : (
    <>
      <AccountFacts account={account} />
      {below}
    </>
  );
}

function AccountEditor({
  account,
  children,
  below,
}: {
  account: Account;
  children: ReactNode;
  below: ReactNode;
}) {
  const refresh = useRefresh();
  const [saved, setSaved] = useState(account);
  const [draft, setDraft] = useState(account);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Bumped on Discard, so the limit field shows the saved value again.
  const [version, setVersion] = useState(0);
  const changed = (key: keyof Account) => draft[key] !== saved[key];
  const dirty = (Object.keys(saved) as (keyof Account)[]).some(changed);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const values = {
        email: draft.email,
        displayName: draft.displayName ?? "",
        isAdmin: draft.isAdmin,
        storageLimitBytes: draft.storageLimitBytes || null,
      };
      // Only what changed, so a stale tab can't put back another edit.
      await sendAdmin(
        `/api/admin/users/${account.id}`,
        "PATCH",
        Object.fromEntries(
          Object.entries(values).filter(([key]) =>
            changed(key as keyof Account),
          ),
        ),
      );
      setSaved(draft);
      toastManager.add({ title: "Saved", type: "success", timeout: 1500 });
      void refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  };
  const discard = () => {
    setDraft(saved);
    setError(null);
    setVersion((current) => current + 1);
  };

  return (
    <>
      <SettingsCard>
        {error ? (
          <Alert className="m-3" variant="error">
            {error}
          </Alert>
        ) : null}
        <SettingsRow
          changed={changed("displayName")}
          htmlFor="user-name"
          label="Name"
        >
          <SettingsText
            id="user-name"
            placeholder="Their name"
            value={draft.displayName ?? ""}
            onChange={(event) =>
              setDraft({ ...draft, displayName: event.target.value || null })
            }
          />
        </SettingsRow>
        <SettingsRow
          changed={changed("email")}
          htmlFor="user-email"
          label="Email"
        >
          <SettingsText
            id="user-email"
            type="email"
            value={draft.email}
            onChange={(event) =>
              setDraft({ ...draft, email: event.target.value })
            }
          />
        </SettingsRow>
        <SettingsRow
          changed={changed("isAdmin")}
          hint={draft.isOwner ? undefined : "Admins can open these pages"}
          label="Role"
        >
          {draft.isOwner ? (
            <Badge variant="accent">Owner</Badge>
          ) : (
            <ToggleGroup
              aria-label="Role"
              size="sm"
              value={[draft.isAdmin ? "admin" : "member"]}
              variant="outline"
              onValueChange={(next) => {
                const role = next[0];
                if (role) setDraft({ ...draft, isAdmin: role === "admin" });
              }}
            >
              <ToggleGroupItem value="member">Member</ToggleGroupItem>
              <ToggleGroupItem value="admin">Admin</ToggleGroupItem>
            </ToggleGroup>
          )}
        </SettingsRow>
        <SettingsRow
          changed={changed("storageLimitBytes")}
          hint="Uploads stop at the limit"
          htmlFor="user-limit"
          label="Storage limit"
        >
          <UnitField
            emptyUnit="GB"
            id="user-limit"
            key={version}
            name="storageLimitBytes"
            placeholder="No limit"
            units={BYTES}
            value={draft.storageLimitBytes}
            onChange={(next) => setDraft({ ...draft, storageLimitBytes: next })}
          />
        </SettingsRow>
        {children}
      </SettingsCard>
      {below}
      {dirty ? (
        <SaveBar
          pending={{ saving, onDiscard: discard, onSave: () => void save() }}
        />
      ) : null}
    </>
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
        <TemporaryPasswordRows />
      </AdminFormDialog>
    </SettingsRow>
  );
}

/** A member's keys, which the owner can delete but never see or make. */
export function MemberKeys({
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
    <AdminGroup title="Keys">
      <KeyList keys={keys} onDelete={canEdit ? remove : undefined} />
    </AdminGroup>
  );
}

const signedOut = (title: string) =>
  toastManager.add({ title, type: "success", timeout: 1500 });

/** What the owner can sign out: one browser, or all of them at once. */
function signOutActions(userId: string, canEdit: boolean, devices: Device[]) {
  if (!canEdit) return {};
  return {
    onSignOut: async (sessionId: string) => {
      await sendAdmin(
        `/api/admin/users/${userId}/sessions/${sessionId}`,
        "DELETE",
      );
      signedOut("Signed out");
    },
    // The server refuses to sign out the browser doing the asking.
    onSignOutOthers: devices.some((device) => device.current)
      ? undefined
      : async () => {
          await sendAdmin(`/api/admin/users/${userId}/sessions`, "DELETE");
          signedOut("Signed out everywhere");
        },
  };
}

/** Single sign-on and password reset rows, with the result shown once. */
export function SignInRows({
  userId,
  signInUrl,
  sso,
  oidcLinked,
}: {
  userId: string;
  signInUrl: string;
  sso: Sso | null;
  oidcLinked: boolean;
}) {
  const [result, setResult] = useState<SignInDetails | null>(null);
  // With passwords off, there is nothing to reset.
  const passwords = sso?.passwordLogin ?? true;
  return (
    <>
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
      <SignInDetailsDialog result={result} onClose={() => setResult(null)} />
    </>
  );
}

/** Where they're signed in, and signing them out when you can edit. */
export function UserDevices({
  userId,
  devices,
  hasKeys,
  canEdit,
}: {
  userId: string;
  devices: Device[];
  hasKeys: boolean;
  canEdit: boolean;
}) {
  return (
    <DeviceList
      devices={devices}
      hasKeys={hasKeys}
      hideAddresses
      {...signOutActions(userId, canEdit, devices)}
    />
  );
}
