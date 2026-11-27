import { Copy, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { ItemIcon } from "@/components/file-list/file-list";
import { api, read } from "@/lib/api";
import { copyText } from "@/lib/clipboard";
import { useRefresh } from "@/lib/use-refresh";
import type { KeyView } from "@/server/auth/keys";
import type { MoveTarget } from "@/server/files/types";
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
import { Field, FieldLabel } from "@staaash/ui/components/field";
import {
  FolderFindInput,
  FolderTreeRow,
} from "@staaash/ui/components/folder-tree";
import { Input } from "@staaash/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@staaash/ui/components/select";
import { toastManager } from "@staaash/ui/components/toast";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@staaash/ui/components/toggle-group";

type Made = { token: string; key: KeyView };

const ENDS = [
  { value: "30", label: "In 30 days", days: 30 },
  { value: "90", label: "In 90 days", days: 90 },
  { value: "365", label: "In a year", days: 365 },
  { value: "never", label: "No end date", days: null },
] as const;

type Ends = (typeof ENDS)[number]["value"];

/** How each AI app is told about Staaash. The key goes in a header. */
const SETUPS = [
  {
    id: "claude-code",
    label: "Claude Code",
    how: "Run this in a terminal.",
    code: (url: string, token: string) =>
      `claude mcp add --transport http staaash ${url} --header "Authorization: Bearer ${token}"`,
  },
  {
    id: "codex",
    label: "Codex",
    how: "Add this to ~/.codex/config.toml.",
    code: (url: string, token: string) =>
      `[mcp_servers.staaash]\nurl = "${url}"\nhttp_headers = { "Authorization" = "Bearer ${token}" }`,
  },
  {
    id: "opencode",
    label: "OpenCode",
    how: "Add this to opencode.json.",
    code: (url: string, token: string) =>
      JSON.stringify(
        {
          $schema: "https://opencode.ai/config.json",
          mcp: {
            servers: {
              staaash: {
                type: "remote",
                url,
                oauth: false,
                headers: { Authorization: `Bearer ${token}` },
              },
            },
          },
        },
        null,
        2,
      ),
  },
  {
    id: "claude-desktop",
    label: "Claude Desktop",
    how: "Add this to claude_desktop_config.json. It needs Node.js.",
    code: (url: string, token: string) =>
      JSON.stringify(
        {
          mcpServers: {
            staaash: {
              command: "npx",
              args: [
                "-y",
                "mcp-remote",
                url,
                "--header",
                "Authorization:${STAAASH_AUTH}",
                // mcp-remote refuses plain http beyond this computer without it.
                ...(url.startsWith("http:") ? ["--allow-http"] : []),
              ],
              env: { STAAASH_AUTH: `Bearer ${token}` },
            },
          },
        },
        null,
        2,
      ),
  },
  {
    id: "open-webui",
    label: "Open WebUI",
    how: "In Admin Panel, open Settings, then External Tools, and add a server. Pick MCP (Streamable HTTP), paste this address, choose Bearer, and paste the key.",
    code: (url: string) => url,
  },
] as const;

type SetupId = (typeof SETUPS)[number]["id"];

const copied = () =>
  toastManager.add({ title: "Copied", type: "success", timeout: 1500 });

function CopyBlock({ label, text }: { label: string; text: string }) {
  return (
    <div className="relative">
      <pre className="m-0 max-h-60 scrollbar-thin overflow-auto rounded-xl bg-hover/60 p-3.5 pe-12 font-mono text-label leading-relaxed wrap-anywhere whitespace-pre-wrap text-foreground">
        {text}
      </pre>
      <Button
        aria-label={`Copy ${label}`}
        className="absolute end-2 top-2"
        size="icon-sm"
        variant="ghost-muted"
        onClick={async () => {
          await copyText(text);
          copied();
        }}
      >
        <Copy aria-hidden />
      </Button>
    </div>
  );
}

/** A row of choices; the picked one's hint shows below. */
function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string; hint?: string }[];
  onChange: (value: T) => void;
}) {
  const hint = options.find((option) => option.value === value)?.hint;
  return (
    <div className="grid gap-2">
      <span className="text-base/4.5 font-medium sm:text-sm/4">{label}</span>
      <ToggleGroup
        aria-label={label}
        className="w-full *:flex-1"
        size="sm"
        value={[value]}
        variant="outline"
        onValueChange={(next) => {
          const picked = next[0];
          if (picked) onChange(picked as T);
        }}
      >
        {options.map((option) => (
          <ToggleGroupItem key={option.value} value={option.value}>
            {option.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      {hint ? (
        <p className="m-0 text-label text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

/** Your folders by path, found by name. */
function FolderPick({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (id: string) => void;
}) {
  const [folders, setFolders] = useState<MoveTarget[] | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    void read(api.api.files.folders.tree.$get()).then(
      (tree) => !cancelled && setFolders(tree.folders),
      () => !cancelled && setFolders([]),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  // The drive's own name comes first in every path; the key never sees it.
  const paths = useMemo(
    () =>
      (folders ?? [])
        .filter((folder) => !folder.isFilesRoot)
        .map((folder) => ({
          ...folder,
          path: folder.pathLabel.split(" / ").slice(1).join(" / "),
        }))
        .sort((a, b) => a.path.localeCompare(b.path)),
    [folders],
  );
  const term = query.trim().toLowerCase();
  const shown = term
    ? paths.filter((folder) => folder.name.toLowerCase().includes(term))
    : paths;

  const body = () => {
    if (!folders) {
      return <p className="m-0 px-2 py-3 text-meta text-muted-foreground">…</p>;
    }
    if (shown.length === 0) {
      return (
        <p className="m-0 px-2 py-3 text-meta text-muted-foreground">
          {term ? "No folder matches" : "You have no folders yet"}
        </p>
      );
    }
    return shown.map((folder) => (
      <FolderTreeRow
        depth={0}
        disabled={false}
        icon={<ItemIcon item={{ kind: "folder", color: folder.color }} />}
        key={folder.id}
        label={folder.path}
        picked={folder.id === value}
        onPick={() => onChange(folder.id)}
      />
    ));
  };

  return (
    <div className="grid gap-2">
      <FolderFindInput value={query} onChange={setQuery} />
      <div
        aria-label="Folders"
        className="h-44 scrollbar-thin overflow-y-auto py-1"
        role="tree"
      >
        {body()}
      </div>
    </div>
  );
}

function EndsField({
  value,
  onChange,
}: {
  value: Ends;
  onChange: (value: Ends) => void;
}) {
  return (
    <div className="grid gap-2">
      <span className="text-base/4.5 font-medium sm:text-sm/4">Ends</span>
      <Select value={value} onValueChange={(next) => onChange(next as Ends)}>
        <SelectTrigger aria-label="Ends" className="w-full">
          <SelectValue>
            {(current: string) =>
              ENDS.find((option) => option.value === current)?.label
            }
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {ENDS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {value === "never" ? (
        <p className="m-0 text-label text-muted-foreground">
          It still stops after a year without use.
        </p>
      ) : null}
    </div>
  );
}

function KeyForm({ onMade }: { onMade: (made: Made) => void }) {
  const [name, setName] = useState("");
  const [use, setUse] = useState<"ai" | "script">("ai");
  const [access, setAccess] = useState<"read" | "change">("read");
  const [scope, setScope] = useState<"drive" | "folder">("drive");
  const [folderId, setFolderId] = useState<string | null>(null);
  const [ends, setEnds] = useState<Ends>("90");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const oneFolder = use === "ai" && scope === "folder";

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      onMade(
        await read(
          api.api.user.keys.$post({
            json: {
              name,
              use,
              readOnly: access === "read",
              folderId: oneFolder ? folderId : null,
              endsInDays:
                ENDS.find((option) => option.value === ends)?.days ?? null,
            },
          }),
        ),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not make it.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="flex min-h-0 flex-col"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <DialogHeader>
        <DialogTitle>New key</DialogTitle>
      </DialogHeader>
      <DialogPanel className="grid gap-5">
        <Field>
          <FieldLabel>Name</FieldLabel>
          <Input
            autoFocus
            maxLength={80}
            placeholder="Claude on my laptop"
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <Choice
          label="Who will use it?"
          options={[
            {
              value: "ai",
              label: "An AI app",
              hint: "Works only through MCP, so an AI app can search, read, and save files.",
            },
            {
              value: "script",
              label: "A script",
              hint: "Works with the Staaash API, for backups and other scripts.",
            },
          ]}
          value={use}
          onChange={setUse}
        />
        <Choice
          label="What can it do?"
          options={[
            { value: "read", label: "Read only" },
            {
              value: "change",
              label: "Read and change",
              hint: "Changes can be undone: replaced and removed files go to Trash.",
            },
          ]}
          value={access}
          onChange={setAccess}
        />
        {use === "ai" ? (
          <div className="grid gap-2">
            <Choice
              label="Which files?"
              options={[
                { value: "drive", label: "Whole drive" },
                { value: "folder", label: "One folder" },
              ]}
              value={scope}
              onChange={setScope}
            />
            {scope === "folder" ? (
              <FolderPick value={folderId} onChange={setFolderId} />
            ) : null}
          </div>
        ) : null}
        <EndsField value={ends} onChange={setEnds} />
        {error ? <Alert variant="error">{error}</Alert> : null}
      </DialogPanel>
      <DialogFooter>
        <Button
          disabled={busy || !name.trim() || (oneFolder && !folderId)}
          type="submit"
        >
          Make key
        </Button>
      </DialogFooter>
    </form>
  );
}

function KeyMade({ made, onDone }: { made: Made; onDone: () => void }) {
  const [setup, setSetup] = useState<SetupId>("claude-code");
  const origin = window.location.origin;
  const url = `${origin}/mcp`;
  const chosen = SETUPS.find((entry) => entry.id === setup) ?? SETUPS[0];

  return (
    <>
      <DialogHeader>
        <DialogTitle>Copy your key</DialogTitle>
      </DialogHeader>
      <DialogPanel className="grid gap-5">
        <div className="grid gap-2">
          <CopyBlock label="key" text={made.token} />
          <p className="m-0 text-label text-muted-foreground">
            It is only shown now. Keep it like a password.
          </p>
        </div>
        {made.key.use === "ai" ? (
          <div className="grid gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-base/4.5 font-medium sm:text-sm/4">
                Set up
              </span>
              <Select
                value={setup}
                onValueChange={(next) => setSetup(next as SetupId)}
              >
                <SelectTrigger aria-label="AI app" className="w-44" size="sm">
                  <SelectValue>
                    {(current: string) =>
                      SETUPS.find((entry) => entry.id === current)?.label
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent align="end" alignItemWithTrigger={false}>
                  {SETUPS.map((entry) => (
                    <SelectItem key={entry.id} value={entry.id}>
                      {entry.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <p className="m-0 text-label text-muted-foreground">{chosen.how}</p>
            <CopyBlock
              label={`${chosen.label} setup`}
              text={chosen.code(url, made.token)}
            />
          </div>
        ) : (
          <div className="grid gap-2">
            <span className="text-base/4.5 font-medium sm:text-sm/4">
              Try it
            </span>
            <CopyBlock
              label="example"
              text={`curl -H "Authorization: Bearer ${made.token}" "${origin}/api/search?q=report"`}
            />
          </div>
        )}
      </DialogPanel>
      <DialogFooter>
        <Button onClick={onDone}>Done</Button>
      </DialogFooter>
    </>
  );
}

/** Makes a key in a dialog, then shows it once with how to set it up. */
export function NewKeyButton() {
  const refresh = useRefresh();
  const [open, setOpen] = useState(false);
  const [made, setMade] = useState<Made | null>(null);

  return (
    <Dialog
      // A stray click outside would lose a key that is only shown once.
      disablePointerDismissal={made !== null}
      open={open}
      onOpenChange={setOpen}
      onOpenChangeComplete={(isOpen) => {
        if (isOpen || !made) return;
        setMade(null);
        void refresh();
      }}
    >
      <DialogTrigger render={<Button size="sm" variant="outline" />}>
        <Plus aria-hidden />
        New key
      </DialogTrigger>
      <DialogPopup className="sm:max-w-120">
        {made ? (
          <KeyMade made={made} onDone={() => setOpen(false)} />
        ) : (
          <KeyForm onMade={setMade} />
        )}
      </DialogPopup>
    </Dialog>
  );
}
