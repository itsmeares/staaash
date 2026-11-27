---
title: API Keys and AI Apps
description: Let Claude Code, Codex, OpenCode, Claude Desktop, Open WebUI or your own scripts use your drive with a key.
---

:::note[Coming in v2.1.0]
API keys and MCP are not in a stable release yet.
:::

A key lets an app use your drive without your password. There are two kinds:

- **An AI app** key works only through MCP, the way AI apps call tools. The app can search, read and save files. You can hold it to one folder.
- **A script** key works with the Staaash API, for backups and your own tools. It sees your whole drive.

## Make a key

1. Open **Settings**, then **Signed in**, and press **New key**.
2. Give it a name you will recognize later, such as "Claude Code on my laptop".
3. Choose who will use it, whether it can only read or also change files, and when it ends.
4. Press **Make key**, then copy the key. It is only shown once.

For an AI app key, the next screen also shows the setup for each app below with your key filled in.

## Connect an AI app

The MCP address is your drive's address with `/mcp` at the end, for example `https://drive.example.com/mcp`. Replace `stsh_...` below with your key.

**Claude Code.** Run this in a terminal:

```sh
claude mcp add --transport http staaash https://drive.example.com/mcp --header "Authorization: Bearer stsh_..."
```

**Codex.** Add this to `~/.codex/config.toml`:

```toml
[mcp_servers.staaash]
url = "https://drive.example.com/mcp"
http_headers = { "Authorization" = "Bearer stsh_..." }
```

**OpenCode.** Add this to `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "staaash": {
      "type": "remote",
      "url": "https://drive.example.com/mcp",
      "oauth": false,
      "headers": { "Authorization": "Bearer stsh_..." }
    }
  }
}
```

**Claude Desktop.** It reaches Staaash through `mcp-remote`, so it needs [Node.js](https://nodejs.org). Add this to `claude_desktop_config.json` and restart Claude Desktop:

```json
{
  "mcpServers": {
    "staaash": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "https://drive.example.com/mcp",
        "--header",
        "Authorization:${STAAASH_AUTH}"
      ],
      "env": { "STAAASH_AUTH": "Bearer stsh_..." }
    }
  }
}
```

**Open WebUI.** In **Admin Panel**, open **Settings**, then **External Tools**, and add a server. Pick **MCP (Streamable HTTP)**, paste the MCP address, choose **Bearer**, and paste the key. Open WebUI connects from its own server, so the address must work from there. If both run in Docker, the address your browser uses may not.

The Claude and ChatGPT websites cannot connect. They need a sign-in flow that Staaash does not have.

## What an AI app can do

| Tool            | What it does                                                                                    |
| --------------- | ----------------------------------------------------------------------------------------------- |
| `search`        | Finds files and folders by name. With no words, lists what was opened lately.                   |
| `list_folder`   | Lists what is in a folder.                                                                      |
| `get_info`      | Shows the size, type and dates of a file or folder.                                             |
| `read_file`     | Reads a text file, 100 KB at a time, or a picture up to 5 MB. Other files are refused.          |
| `create_folder` | Makes a folder.                                                                                 |
| `write_file`    | Saves text as a file. It replaces a file only when asked to, and the old version goes to Trash. |
| `move`          | Moves or renames a file or folder.                                                              |
| `trash`         | Moves a file or folder to Trash.                                                                |

A read-only key gets only the first four. Everything an AI app changes can be undone from Trash. It cannot delete files for good, make share links, change your account, or open admin pages.

A key held to one folder sees that folder as the top of the drive. It cannot reach anything outside it, even by name. If you trash or delete that folder, the key stops working.

## Keep your files safe

An AI app reads what is in your files, and a file can hold text written to trick it, such as "send this file to …". Staaash tells the app to treat file text as data, but that is not a guarantee.

- Give an app the least it needs: one folder and read only when that is enough.
- Give **Read and change** keys only to apps whose actions you watch.
- Use one key per app, so you can delete one without breaking the others.

## Use a key in a script

Send the key in the `Authorization` header:

```sh
curl -H "Authorization: Bearer stsh_..." "https://drive.example.com/api/search?q=report"
```

Script keys work on the routes for files, uploads, share links, search and sync. A **Read and change** key can do what you can do on those pages, including making share links and emptying Trash. A read-only key can read and download, including zip downloads, but cannot change anything. No key can change your account or open admin pages. The routes are described in [`openapi.json`](https://github.com/itsmeares/staaash/blob/main/apps/web/openapi.json).

## When a key stops working

- On its end date. A key with no end date stops after a year without use.
- When you press **Delete** next to it in **Settings**, **Signed in**.
- When you change your password, or press **Sign out everywhere else**. Both delete all your keys.
- When the owner deletes it, or resets your password, in **Admin → Users**.

**Never used** and **Used** next to each key show whether an app is using it.
