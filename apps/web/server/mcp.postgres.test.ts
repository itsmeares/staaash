import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";

import { getPrisma } from "@staaash/db/client";
import { beforeAll, describe, expect, it } from "vite-plus/test";

import { createKey } from "@/server/auth/keys";
import { createFilesService } from "@/server/files/service";
import { createApp } from "@/server/http/core";
import { mcpRoutes } from "@/server/http/routes/mcp";
import { getStoragePath } from "@/server/storage";

const db = getPrisma();
const files = createFilesService();
const app = createApp().route("/", mcpRoutes);

beforeAll(async () => {
  await db.instance.upsert({
    where: { id: "singleton" },
    create: {
      id: "singleton",
      name: "Test drive",
      authSecret: "test-only",
      storageProtocolVersion: 2,
    },
    update: { storageProtocolVersion: 2 },
  });
});

/** A drive with /Trips/plan.md and /Work/secret.txt. */
const drive = async () => {
  const id = randomUUID();
  await db.user.create({
    data: {
      id,
      email: `${id}@mcp.test`,
      storageId: id,
      passwordHash: "test-only",
      preferences: { create: { onboardingCompletedAt: new Date() } },
    },
  });
  const root = await db.folder.create({
    data: { ownerUserId: id, name: "Files", isFilesRoot: true },
  });
  await mkdir(getStoragePath(`files/${id}`), { recursive: true });
  const actor = { actorUserId: id, actorRole: "member" as const };
  const { folders } = await files.ensureFolderPaths({
    ...actor,
    parentId: root.id,
    paths: ["Trips", "Work"],
    idempotencyKey: randomUUID(),
  });
  const folderId = (name: string) =>
    folders.find((folder) => folder.path === name)!.folderId;
  for (const [folder, name, text] of [
    ["Trips", "plan.md", "Day 1: the coast"],
    ["Work", "secret.txt", "trips budget"],
  ] as const) {
    await files.uploadFiles({
      ...actor,
      folderId: folderId(folder),
      idempotencyKey: randomUUID(),
      items: [
        {
          clientKey: name,
          originalName: name,
          conflictStrategy: "fail",
          file: new File([text], name, { type: "text/plain" }),
        },
      ],
    });
  }
  return { id, trips: folderId("Trips"), work: folderId("Work") };
};

type ToolResult = {
  isError?: boolean;
  content: { type: string; text?: string }[];
};

let requestId = 0;
const rpc = async (token: string, method: string, params: object) => {
  const response = await app.request("http://localhost/mcp", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2025-06-18",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: ++requestId,
      method,
      params,
    }),
  });
  expect(response.status).toBe(200);
  // Older clients get the answer as one server-sent event.
  const body = await response.text();
  const data = body.startsWith("{")
    ? body
    : body
        .split("\n")
        .find((line) => line.startsWith("data: "))!
        .slice(6);
  return (JSON.parse(data) as { result: unknown }).result;
};

const tool = async (token: string, name: string, args: object = {}) => {
  const result = (await rpc(token, "tools/call", {
    name,
    arguments: args,
  })) as ToolResult;
  const text = result.content.map((part) => part.text ?? "").join("\n");
  return { error: result.isError ? text : null, text };
};

const json = (text: string) => JSON.parse(text) as Record<string, unknown>;

const key = async (
  userId: string,
  options: { readOnly?: boolean; folderId?: string | null } = {},
) =>
  (
    await createKey(userId, {
      name: "Test",
      use: "ai",
      readOnly: options.readOnly ?? false,
      folderId: options.folderId ?? null,
      endsInDays: 30,
    })
  ).token;

describe("MCP", () => {
  it("shows a folder key only what is inside its folder", async () => {
    const { id, trips } = await drive();
    const token = await key(id, { folderId: trips });

    const listing = json(
      (await tool(token, "list_folder", { path: "/" })).text,
    );
    expect(listing.entries).toEqual([
      expect.objectContaining({ path: "/plan.md", kind: "file" }),
    ]);
    // "Work" is outside, and "trips budget" only matches by its text.
    const found = json((await tool(token, "search", { query: "trips" })).text);
    expect(found.results).toEqual([]);
    expect(
      json((await tool(token, "search", { query: "plan" })).text).results,
    ).toEqual([expect.objectContaining({ path: "/plan.md" })]);
    expect((await tool(token, "read_file", { path: "/plan.md" })).text).toBe(
      "Day 1: the coast",
    );
    expect((await tool(token, "get_info", { path: "/../Work" })).error).toMatch(
      /without "\." or "\.\."/,
    );
    expect(
      (await tool(token, "read_file", { path: "/Work/secret.txt" })).error,
    ).toBe("Nothing is at /Work/secret.txt.");
  });

  it("sees the whole drive without a folder", async () => {
    const { id } = await drive();
    const token = await key(id);
    const found = json((await tool(token, "search", { query: "secret" })).text);
    expect(found.results).toEqual([
      expect.objectContaining({ path: "/Work/secret.txt" }),
    ]);
  });

  it("keeps the old version in Trash when write_file replaces a file", async () => {
    const { id, trips } = await drive();
    const token = await key(id, { folderId: trips });

    expect(
      (await tool(token, "write_file", { path: "/plan.md", content: "new" }))
        .error,
    ).toMatch(/already exists/);
    const replaced = await tool(token, "write_file", {
      path: "/plan.md",
      content: "Day 1: the hills",
      replace: true,
    });
    expect(replaced.error).toBeNull();
    expect((await tool(token, "read_file", { path: "/plan.md" })).text).toBe(
      "Day 1: the hills",
    );
    const plans = await db.file.findMany({
      where: { ownerUserId: id, folderId: trips },
      select: { originalName: true, deletedAt: true },
    });
    expect(plans).toHaveLength(2);
    expect(plans.filter((file) => file.deletedAt)).toEqual([
      expect.objectContaining({ originalName: "plan.md" }),
    ]);
  });

  it("makes folders, moves, renames, and trashes inside the folder", async () => {
    const { id, trips } = await drive();
    const token = await key(id, { folderId: trips });

    expect(
      (await tool(token, "create_folder", { path: "/Days/One" })).error,
    ).toBeNull();
    expect(
      (await tool(token, "move", { from: "/plan.md", to: "/Days/One/day.md" }))
        .error,
    ).toBeNull();
    expect(
      (await tool(token, "move", { from: "/Days", to: "/Itinerary" })).error,
    ).toBeNull();
    expect(
      (await tool(token, "read_file", { path: "/Itinerary/One/day.md" })).text,
    ).toBe("Day 1: the coast");
    expect(
      (await tool(token, "trash", { path: "/Itinerary" })).error,
    ).toBeNull();
    expect(
      json((await tool(token, "list_folder", { path: "/" })).text).entries,
    ).toEqual([]);
    expect((await tool(token, "trash", { path: "/" })).error).toBe(
      "The top folder can't go to the Trash.",
    );
  });

  it("gives a read-only key no tools that change anything", async () => {
    const { id } = await drive();
    const token = await key(id, { readOnly: true });
    const { tools } = (await rpc(token, "tools/list", {})) as {
      tools: { name: string }[];
    };
    expect(tools.map((entry) => entry.name).sort()).toEqual([
      "get_info",
      "list_folder",
      "read_file",
      "search",
    ]);
  });

  it("refuses a key whose folder went to the Trash", async () => {
    const { id, trips } = await drive();
    const token = await key(id, { folderId: trips });
    await files.trashFolder({
      actorUserId: id,
      actorRole: "member",
      folderId: trips,
      idempotencyKey: randomUUID(),
    });
    expect((await tool(token, "list_folder")).error).toMatch(
      /folder is gone or in the trash/,
    );
  });

  it("holds only AI keys to a folder, and only to one of yours", async () => {
    const mine = await drive();
    const theirs = await drive();
    const make = (use: "ai" | "script", folderId: string) =>
      createKey(mine.id, {
        name: "Test",
        use,
        readOnly: true,
        folderId,
        endsInDays: null,
      });
    await expect(make("script", mine.trips)).rejects.toMatchObject({
      code: "KEY_FOLDER_INVALID",
    });
    await expect(make("ai", theirs.trips)).rejects.toMatchObject({
      code: "KEY_FOLDER_INVALID",
    });
    const { key: made } = await make("ai", mine.trips);
    expect(made).toMatchObject({
      use: "ai",
      readOnly: true,
      folder: { id: mine.trips, name: "Trips" },
      expiresAt: null,
      lastUsedAt: null,
    });
  });
});
