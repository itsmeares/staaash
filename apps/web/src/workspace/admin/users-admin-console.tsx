import { useRefresh } from "@/lib/use-refresh";
import { AlertTriangle, ChevronRight, Plus, Search } from "lucide-react";
import { AppLink } from "@/components/app-link";
import { useState } from "react";

import { BYTES, UnitField } from "@staaash/ui/components/unit-field";
import { SettingsRow, SettingsText } from "@/components/settings-layout";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@staaash/ui/components/badge";
import { Button } from "@staaash/ui/components/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@staaash/ui/components/input-group";
import { Tabs, TabsList, TabsTab } from "@staaash/ui/components/tabs";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@staaash/ui/components/toggle-group";
import { cn } from "@staaash/ui/utils";
import { formatBytes } from "@/lib/format-bytes";
import { formatRelativeTime } from "@/lib/time";
import { getInitials, roleLabel } from "@/lib/user";
import { useTime } from "@/components/time-provider";
import {
  PAGE_SIZE,
  PaginationControls,
  buildPageHref,
} from "@/src/pagination-controls";

import { Avatar } from "@staaash/ui/components/avatar";
import { AdminPage } from "./admin-panel";
import {
  AdminFormDialog,
  sendAdmin,
  type SignInDetails,
  SignInDetailsDialog,
  type Sso,
  TemporaryPasswordRows,
  temporaryPasswordPayload,
} from "./temporary-password";

export type AdminUserRow = {
  id: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  role: "owner" | "admin" | "member";
  storageLimitBytes: string | null;
  storageUsedBytes: string;
  files: number;
  lastActiveAt: string | null;
  /** From `accountNote`. */
  note: string | null;
};

type Space = { used: string; limit: string | null };

const usedPercent = ({ used, limit }: Space) =>
  limit && BigInt(limit) > 0n
    ? Number((BigInt(used) * 100n) / BigInt(limit))
    : null;

const COLUMNS =
  "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-6 md:grid-cols-[minmax(13rem,1.6fr)_6rem_minmax(10rem,1.2fr)_5rem_7rem_1rem]";

const SPACE_SIZES = {
  small: { text: "text-meta", used: "", noLimit: "· no limit", bar: "h-1" },
  large: {
    text: "text-body",
    used: "font-semibold",
    noLimit: "used, no limit",
    bar: "h-1.5",
  },
};

/** Space used against the limit; the bar turns yellow close to it. */
export function SpaceUse({
  large = false,
  ...space
}: Space & { large?: boolean }) {
  const percent = usedPercent(space);
  const size = SPACE_SIZES[large ? "large" : "small"];
  // Uploads stop at the limit; say so a little before.
  const near = percent !== null && percent >= 90;
  return (
    <span className="grid gap-1.5">
      <span className={cn("flex items-center gap-1.5 tabular-nums", size.text)}>
        {near ? (
          <AlertTriangle
            aria-label="Close to the limit"
            className="size-3.5 text-warning-foreground"
          />
        ) : null}
        <span className={size.used}>{formatBytes(BigInt(space.used))}</span>
        <span className="text-muted-foreground">
          {space.limit
            ? `of ${formatBytes(BigInt(space.limit))}`
            : size.noLimit}
        </span>
      </span>
      {percent === null ? null : (
        <span
          className={cn(
            "block overflow-hidden rounded-full bg-pressed",
            size.bar,
          )}
        >
          <span
            className={cn(
              "block h-full rounded-full",
              near ? "bg-warning" : "bg-primary",
            )}
            style={{ width: `${Math.min(percent, 100)}%` }}
          />
        </span>
      )}
    </span>
  );
}

function UserRow({ user }: { user: AdminUserRow }) {
  const { now, timeZone } = useTime();
  return (
    <AppLink
      className={cn(
        COLUMNS,
        "min-h-15 border-t border-border px-4 py-2.5 outline-none first:border-t-0 hover:bg-hover focus-visible:bg-hover",
      )}
      href={`/admin/users/${user.id}`}
    >
      <span className="grid min-w-0 gap-2">
        <span className="flex min-w-0 items-center gap-3">
          <Avatar
            avatarUrl={user.avatarUrl}
            initials={getInitials(user.displayName, user.email)}
          />
          <span className="grid min-w-0">
            <span className="truncate text-body font-medium">
              {user.displayName ?? user.email}
            </span>
            <span className="truncate text-label text-muted-foreground">
              {user.note ? (
                <span className="text-warning-foreground">{user.note}</span>
              ) : (
                user.email
              )}
            </span>
          </span>
        </span>
        <span className="ps-10 md:hidden">
          <SpaceUse
            limit={user.storageLimitBytes}
            used={user.storageUsedBytes}
          />
        </span>
      </span>
      <span className="hidden md:block">
        <Badge variant={user.role === "owner" ? "accent" : "neutral"}>
          {roleLabel(user.role)}
        </Badge>
      </span>
      <span className="hidden md:block">
        <SpaceUse limit={user.storageLimitBytes} used={user.storageUsedBytes} />
      </span>
      <span className="hidden text-end text-meta text-muted-foreground tabular-nums md:block">
        {user.files ? user.files.toLocaleString() : "None"}
      </span>
      <span className="hidden text-meta text-muted-foreground md:block">
        {user.lastActiveAt
          ? formatRelativeTime(user.lastActiveAt, now, timeZone)
          : "Never"}
      </span>
      <ChevronRight aria-hidden className="size-4 text-muted-foreground" />
    </AppLink>
  );
}

const FILTERS = {
  all: { label: "All", match: () => true },
  admins: {
    label: "Admins",
    match: (user: AdminUserRow) => user.role !== "member",
  },
  members: {
    label: "Members",
    match: (user: AdminUserRow) => user.role === "member",
  },
  setup: {
    label: "Not set up",
    match: (user: AdminUserRow) => user.note === "Hasn't finished setup",
  },
} satisfies Record<
  string,
  { label: string; match: (user: AdminUserRow) => boolean }
>;

type Filter = keyof typeof FILTERS;

/** Only shown when both single sign-on and passwords are on. */
function SignInWithRow({
  name,
  sso,
  onChange,
}: {
  name: string;
  sso: boolean;
  onChange: (sso: boolean) => void;
}) {
  return (
    <SettingsRow label="Signs in with">
      <ToggleGroup
        aria-label="Signs in with"
        size="sm"
        value={[sso ? "sso" : "password"]}
        variant="outline"
        onValueChange={(next) => {
          if (next[0]) onChange(next[0] === "sso");
        }}
      >
        <ToggleGroupItem value="sso">{name}</ToggleGroupItem>
        <ToggleGroupItem value="password">Password</ToggleGroupItem>
      </ToggleGroup>
    </SettingsRow>
  );
}

function InviteDialog({
  signInUrl,
  sso,
}: {
  signInUrl: string;
  sso: Sso | null;
}) {
  const refresh = useRefresh();
  const [limit, setLimit] = useState("");
  // With single sign-on set up, inviting through it is the usual choice.
  const [viaSso, setViaSso] = useState(sso !== null);
  const [admin, setAdmin] = useState(false);
  const [result, setResult] = useState<SignInDetails | null>(null);

  const invite = async (form: FormData) => {
    const body = await sendAdmin<{
      user: { email: string };
      temporaryPassword: string | null;
      inviteUrl: string | null;
    }>("/api/admin/users", "POST", {
      email: String(form.get("email") ?? ""),
      ...(viaSso ? { signInWith: "oidc" } : temporaryPasswordPayload(form)),
      storageLimitBytes: limit || null,
      isAdmin: form.get("isAdmin") === "on",
    });
    setResult({
      email: body.user.email,
      temporaryPassword: body.temporaryPassword,
      inviteUrl: body.inviteUrl,
      signInUrl,
    });
    setLimit("");
    setAdmin(false);
    void refresh();
  };

  return (
    <>
      <AdminFormDialog
        submitLabel="Invite"
        title="Invite someone"
        trigger={<Button />}
        triggerLabel={
          <>
            <Plus aria-hidden />
            Invite
          </>
        }
        onSubmit={invite}
      >
        <SettingsRow htmlFor="invite-email" label="Email">
          <SettingsText
            autoComplete="off"
            id="invite-email"
            name="email"
            placeholder="name@example.com"
            required
            type="email"
          />
        </SettingsRow>
        <SettingsRow label="Role">
          <input name="isAdmin" type="hidden" value={admin ? "on" : ""} />
          <ToggleGroup
            aria-label="Role"
            size="sm"
            value={[admin ? "admin" : "member"]}
            variant="outline"
            onValueChange={(next) => {
              if (next[0]) setAdmin(next[0] === "admin");
            }}
          >
            <ToggleGroupItem value="member">Member</ToggleGroupItem>
            <ToggleGroupItem value="admin">Admin</ToggleGroupItem>
          </ToggleGroup>
        </SettingsRow>
        <SettingsRow htmlFor="invite-limit" label="Storage limit">
          <UnitField
            emptyUnit="GB"
            id="invite-limit"
            name="storageLimitBytes"
            placeholder="No limit"
            units={BYTES}
            value={limit}
            onChange={setLimit}
          />
        </SettingsRow>
        {sso?.passwordLogin ? (
          <SignInWithRow name={sso.name} sso={viaSso} onChange={setViaSso} />
        ) : null}
        {viaSso ? null : <TemporaryPasswordRows />}
      </AdminFormDialog>
      <SignInDetailsDialog result={result} onClose={() => setResult(null)} />
    </>
  );
}

export function UsersAdminConsole({
  users,
  page,
  signInUrl,
  sso,
  canInvite,
}: {
  users: AdminUserRow[];
  page: number;
  signInUrl: string;
  sso: Sso | null;
  canInvite: boolean;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const shown = users
    .filter(FILTERS[filter].match)
    .filter(
      (user) =>
        !needle ||
        user.email.toLowerCase().includes(needle) ||
        user.displayName?.toLowerCase().includes(needle),
    )
    .sort((a, b) => {
      const left = BigInt(a.storageUsedBytes);
      const right = BigInt(b.storageUsedBytes);
      return right > left ? 1 : right < left ? -1 : 0;
    });
  const totalPages = Math.ceil(shown.length / PAGE_SIZE);
  const current = Math.min(page, Math.max(totalPages, 1));
  const filters = (Object.keys(FILTERS) as Filter[]).flatMap((key) => {
    const count = users.filter(FILTERS[key].match).length;
    return key === "setup" && count === 0 ? [] : [{ key, count }];
  });

  return (
    <AdminPage>
      <PageHeader
        actions={
          canInvite ? <InviteDialog signInUrl={signInUrl} sso={sso} /> : null
        }
        title="Users"
      />
      <div className="flex flex-wrap items-center gap-3">
        <InputGroup className="w-full sm:w-64">
          <InputGroupAddon>
            <Search aria-hidden />
          </InputGroupAddon>
          <InputGroupInput
            aria-label="Search people"
            placeholder="Search people"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </InputGroup>
        <Tabs
          value={filter}
          onValueChange={(value) => setFilter(value as Filter)}
        >
          <TabsList>
            {filters.map(({ key, count }) => (
              <TabsTab key={key} value={key}>
                {FILTERS[key].label}
                <span className="text-muted-foreground tabular-nums">
                  {count}
                </span>
              </TabsTab>
            ))}
          </TabsList>
        </Tabs>
      </div>
      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <div
          className={cn(
            COLUMNS,
            "hidden border-b border-border px-4 py-2.5 text-label font-medium text-muted-foreground md:grid",
          )}
        >
          <span>Name</span>
          <span>Role</span>
          <span>Space used</span>
          <span className="text-end">Files</span>
          <span>Last change</span>
          <span />
        </div>
        {shown.length === 0 ? (
          <p className="m-0 px-4 py-6 text-center text-body text-muted-foreground">
            No one matches.
          </p>
        ) : (
          shown
            .slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE)
            .map((user) => <UserRow key={user.id} user={user} />)
        )}
      </div>
      {totalPages > 1 ? (
        <div className="flex justify-end">
          <PaginationControls
            buildHref={buildPageHref("/admin/users")}
            page={current}
            totalPages={totalPages}
          />
        </div>
      ) : null}
    </AdminPage>
  );
}
