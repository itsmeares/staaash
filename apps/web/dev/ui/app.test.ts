import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { InferResponseType } from "hono/client";
import type { api } from "../../lib/api";
import { createPreviewApp } from "./app";

vi.mock("pg", () => {
  throw new Error("The UI preview must not import a database driver.");
});
vi.mock("@staaash/db/client", () => {
  throw new Error("The UI preview must not import the database client.");
});

type Files = InferResponseType<typeof api.api.views.files.$get, 200>;
const previews: ReturnType<typeof createPreviewApp>[] = [];
afterEach(() => {
  for (const preview of previews) preview.close();
  previews.length = 0;
});
function browser(preview = createPreviewApp()) {
  previews.push(preview);
  let cookie = "";
  const request = async (path: string, options: RequestInit = {}) => {
    const headers = new Headers(options.headers);
    if (cookie) headers.set("cookie", cookie);
    const response = await preview.app.request(
      new Request(`http://preview.test${path}`, { ...options, headers }),
    );
    const setCookie = response.headers
      .getSetCookie()
      .find((value) => value.startsWith("staaash_ui_session="));
    if (setCookie) cookie = setCookie.split(";")[0]!;
    return response;
  };
  const post = (path: string, body: unknown = {}) =>
    request(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  const read = async <T>(path: string, options?: RequestInit) => {
    const response = await request(path, options);
    expect(response.status, `${path}: ${await response.clone().text()}`).toBe(
      200,
    );
    return (await response.json()) as T;
  };
  const scenario = async (value: string) => {
    expect(
      (
        await request("/__ui/scenario", {
          method: "POST",
          body: new URLSearchParams({ scenario: value }),
        })
      ).status,
    ).toBe(303);
  };
  return { request, post, read, scenario };
}

describe("preview review regressions", () => {
  it("runs an advertised job kind after its previous job was dismissed", async () => {
    const client = browser();
    expect((await client.post("/api/admin/jobs/job-0/dismiss")).status).toBe(
      200,
    );
    const run = await client.post("/api/admin/jobs/run", {
      kind: "staging.cleanup",
    });
    expect(run.status).toBe(200);
    const { jobId } = (await run.json()) as { jobId: string };
    const jobs = await client.read<{
      items: Array<{ id: string; status: string }>;
    }>("/api/admin/jobs");
    expect(jobs.items).toContainEqual(
      expect.objectContaining({ id: jobId, status: "succeeded" }),
    );
    expect(
      (await client.post("/api/admin/jobs/run", { kind: "not-a-job" })).status,
    ).toBe(400);
  });

  it("validates manual temporary passwords and handles empty generated-password fields", async () => {
    const client = browser();
    const manual = {
      email: "manual@staaash.test",
      generateTemporaryPassword: false,
      temporaryPassword: "manual-preview-password",
      confirmTemporaryPassword: "different-preview-password",
    };
    expect((await client.post("/api/admin/users", manual)).status).toBe(400);
    expect(
      (
        await client.post("/api/admin/users", {
          ...manual,
          temporaryPassword: "",
          confirmTemporaryPassword: "",
        })
      ).status,
    ).toBe(400);
    const created = await client.post("/api/admin/users", {
      ...manual,
      confirmTemporaryPassword: manual.temporaryPassword,
    });
    expect(created.status).toBe(201);
    const { user } = (await created.json()) as { user: { id: string } };
    expect(
      (
        await client.post(`/api/admin/users/${user.id}/password-reset`, {
          generateTemporaryPassword: false,
          temporaryPassword: "",
          confirmTemporaryPassword: "",
        })
      ).status,
    ).toBe(400);
    const reset = await client.post(
      `/api/admin/users/${user.id}/password-reset`,
      {
        generateTemporaryPassword: true,
        temporaryPassword: "",
        confirmTemporaryPassword: "",
      },
    );
    expect(reset.status).toBe(200);
    expect(await reset.json()).toMatchObject({
      temporaryPassword: "preview-password",
    });
    const generated = await client.post("/api/admin/users", {
      email: "generated@staaash.test",
      generateTemporaryPassword: true,
      temporaryPassword: "",
      confirmTemporaryPassword: "",
    });
    expect(generated.status).toBe(201);
    expect(await generated.json()).toMatchObject({
      temporaryPassword: "preview-password",
    });
    await client.post("/api/auth/sign-out");
    expect(
      (
        await client.post("/api/auth/sign-in", {
          email: manual.email,
          password: "preview-password",
        })
      ).status,
    ).toBe(200);
  });

  it("requires a session for first-run writes and validates owner onboarding settings", async () => {
    const client = browser();
    const settings = {
      mediaPreviewEnabled: false,
      mediaPreviewGenerateOnUpload: false,
      mediaPreviewGenerateOnFirstView: true,
      mediaPreviewGenerateOnShare: false,
      updateCheckEnabled: false,
      timeZone: "Europe/London",
    };
    await client.scenario("signed-out");
    expect(
      (
        await client.post("/api/auth/password-change-required", {
          password: "new-preview-password",
          confirmPassword: "new-preview-password",
        })
      ).status,
    ).toBe(401);
    expect(
      (await client.post("/api/auth/onboarding/settings", settings)).status,
    ).toBe(401);
    await client.scenario("member");
    expect(
      (await client.post("/api/auth/onboarding/settings", settings)).status,
    ).toBe(403);
    await client.scenario("setup");
    expect(
      (
        await client.post("/api/auth/setup", {
          email: "owner@staaash.test",
          password: "preview-password",
          instanceName: "Sample drive",
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await client.post("/api/auth/onboarding/settings", {
          ...settings,
          updateCheckEnabled: "wrong",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await client.post("/api/auth/onboarding/settings", {
          ...settings,
          id: "wrong",
        })
      ).status,
    ).toBe(200);
    await client.post("/api/user/preferences", { theme: "light" });
    expect(await client.read("/api/views/admin/settings")).toMatchObject({
      settings: { id: "singleton", ...settings },
    });
  });

  it("requires a new share unlock after its password changes", async () => {
    const client = browser();
    await client.post("/s/owner-locked/unlock", {
      password: "preview-password",
    });
    expect(await client.read("/s/owner-locked/view")).toMatchObject({
      resolution: { kind: "file" },
    });
    expect(
      (
        await client.post("/api/shares/owner-share-locked/password", {
          password: "x",
        })
      ).status,
    ).toBe(400);
    expect(await client.read("/s/owner-locked/view")).toMatchObject({
      resolution: { kind: "file" },
    });
    expect(
      (
        await client.post("/api/shares/owner-share-locked/password", {
          password: "new-link-password",
        })
      ).status,
    ).toBe(200);
    expect(await client.read("/s/owner-locked/view")).toMatchObject({
      resolution: { kind: "locked" },
    });
    expect((await client.request("/s/owner-locked/content")).status).toBe(403);
    await client.post("/s/owner-locked/unlock", {
      password: "new-link-password",
    });
    expect((await client.request("/s/owner-locked/content")).status).toBe(200);
  });

  it("applies the real content policy to uploaded public shares", async () => {
    const client = browser();
    const form = new FormData();
    form.set("folderId", "owner-root");
    form.append(
      "files",
      new File(["<script>document.title='unsafe'</script>"], "sample.html", {
        type: "text/html",
      }),
    );
    const upload = await client.request("/api/files/files", {
      method: "POST",
      body: form,
    });
    expect(upload.status).toBe(201);
    const { uploadedFiles } = (await upload.json()) as {
      uploadedFiles: Array<{ id: string }>;
    };
    const privateContent = await client.request(
      `/api/files/files/${uploadedFiles[0]!.id}/content`,
    );
    expect(privateContent.headers.get("content-security-policy")).toContain(
      "sandbox",
    );
    expect(privateContent.headers.get("x-content-type-options")).toBe(
      "nosniff",
    );
    const share = await client.post("/api/shares", {
      targetType: "file",
      fileId: uploadedFiles[0]!.id,
    });
    const {
      share: { shareUrl },
    } = (await share.json()) as { share: { shareUrl: string } };
    const html = await client.request(new URL(shareUrl).pathname + "/content");
    expect(html.status).toBe(200);
    expect(html.headers.get("content-type")).toBe("application/octet-stream");
    expect(html.headers.get("content-disposition")).toMatch(/^attachment;/);
    expect(html.headers.get("content-security-policy")).toContain("sandbox");
    expect(html.headers.get("x-content-type-options")).toBe("nosniff");
    const photo = await client.request("/s/owner-photo/content");
    expect(photo.headers.get("content-type")).toBe("image/jpeg");
    expect(photo.headers.get("content-disposition")).toMatch(/^inline;/);
    const download = await client.request("/s/owner-photo/download");
    expect(download.headers.get("content-disposition")).toMatch(/^attachment;/);
  });

  for (const [scenario, firstRun] of [
    ["invited", "member-password"],
    ["onboarding", "member"],
    ["password", "password"],
  ] as const)
    it(`keeps the ${scenario} first-run step after signing in again`, async () => {
      const client = browser();
      await client.scenario(scenario);
      await client.post("/api/auth/sign-out");
      expect(
        (
          await client.post("/api/auth/sign-in", {
            email: "member@staaash.test",
            password: "preview-password",
          })
        ).status,
      ).toBe(200);
      expect(await client.read("/api/views/entry")).toMatchObject({ firstRun });
    });

  it("keeps received upload bytes after a completion conflict and allows a retry", async () => {
    const client = browser();
    const start = await client.post("/api/uploads/sessions", {
      originalName: "Chunked.txt",
      mimeType: "text/plain",
      totalSizeBytes: 5,
      folderId: "owner-root",
    });
    const { id } = (await start.json()) as { id: string };
    expect(
      (
        await client.request(`/api/uploads/sessions/${id}`, {
          method: "PATCH",
          headers: { "content-range": "bytes 0-4/5" },
          body: "hello",
        })
      ).status,
    ).toBe(200);
    await client.post("/api/files/files/owner-notes/rename", {
      name: "Chunked.txt",
    });
    expect(
      (await client.post(`/api/uploads/sessions/${id}/complete`)).status,
    ).toBe(409);
    expect(await client.read(`/api/uploads/sessions/${id}`)).toMatchObject({
      receivedBytes: 5,
    });
    await client.post("/api/files/files/owner-notes/rename", {
      name: "Trip notes.md",
    });
    const complete = await client.post(`/api/uploads/sessions/${id}/complete`);
    expect(complete.status).toBe(201);
    const file = (await complete.json()) as { id: string };
    expect(
      await (
        await client.request(`/api/files/files/${file.id}/content`)
      ).text(),
    ).toBe("hello");
  });

  it("returns a bad-request reply for malformed JSON across route groups", async () => {
    const client = browser();
    for (const path of [
      "/api/auth/sign-in",
      "/api/admin/users",
      "/api/shares",
      "/api/uploads/sessions",
    ])
      expect(
        (
          await client.request(path, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: "{",
          })
        ).status,
        path,
      ).toBe(400);
  });
});

describe("database-free sample drive", () => {
  it("accepts bodyless file actions and rejects malformed JSON", async () => {
    const client = browser();
    expect(
      (
        await client.request("/api/files/files/owner-coast/opened", {
          method: "POST",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await client.request("/api/files/files/owner-coast/trash", {
          method: "POST",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await client.request("/api/files/files/owner-coast/restore", {
          method: "POST",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await client.request("/api/files/files/owner-coast/rename", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{",
        })
      ).status,
    ).toBe(400);
    const response = await client.request("/api/views/files/missing-folder");
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: "FOLDER_NOT_FOUND" });
  });
  it("opens every page's data without loading the database", async () => {
    const client = browser();
    for (const path of [
      "entry",
      "shell",
      "home",
      "files",
      "files/owner-photos",
      "viewer/owner-coast",
      "settings",
      "admin/overview",
      "admin/storage",
      "admin/users",
      "admin/users/member",
      "admin/jobs",
      "admin/settings",
    ])
      await client.read(`/api/views/${path}`);
    const files = await client.read<Files>("/api/views/files");
    expect(files.listing.total).toBeGreaterThan(10);
    expect(files.listing.total).toBeLessThan(25);
    expect(files.listing.files.map((f) => f.viewerKind)).toEqual(
      expect.arrayContaining(["image", "video", "audio", "pdf", "text", null]),
    );
    const storage = await client.read<
      InferResponseType<typeof api.api.views.admin.storage.$get, 200>
    >("/api/views/admin/storage");
    expect(storage.summary.retainedFileCount).toBeGreaterThan(
      files.listing.files.length,
    );
    expect(storage.summary.rows.map((u) => u.userId)).toEqual([
      "owner",
      "admin",
      "member",
    ]);
  });
  it("keeps rename, search, trash, restore, and storage totals consistent", async () => {
    const client = browser();
    const initial = await client.read<
      InferResponseType<typeof api.api.views.settings.$get, 200>
    >("/api/views/settings");
    expect(
      (
        await client.post("/api/files/files/owner-coast/rename", {
          name: "New coast.jpg",
        })
      ).status,
    ).toBe(200);
    const search = await client.read<{ items: Array<{ name: string }> }>(
      "/api/views/search?q=new%20coast",
    );
    expect(search.items.map((i) => i.name)).toEqual(["New coast.jpg"]);
    expect(
      (await client.post("/api/files/files/owner-coast/trash")).status,
    ).toBe(200);
    expect(
      (await client.read<Files>("/api/views/files")).listing.files.some(
        (f) => f.id === "owner-coast",
      ),
    ).toBe(false);
    const trash = await client.post("/api/views/trash", { query: {} });
    expect(await trash.json()).toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({ id: "owner-coast", name: "New coast.jpg" }),
      ]),
    });
    const after = await client.read<
      InferResponseType<typeof api.api.views.settings.$get, 200>
    >("/api/views/settings");
    expect(after.storage.usedBytes).toBe(initial.storage.usedBytes);
    expect(after.storage.byKind.trash).toBeGreaterThan(
      initial.storage.byKind.trash,
    );
    expect(
      (await client.post("/api/files/files/owner-coast/restore")).status,
    ).toBe(200);
    expect(
      (await client.read<Files>("/api/views/files")).listing.files.find(
        (f) => f.id === "owner-coast",
      )?.name,
    ).toBe("New coast.jpg");
  });
  it("isolates browser sessions and restores the seed on reset", async () => {
    const preview = createPreviewApp();
    const a = browser(preview),
      b = browser(preview);
    await a.post("/api/files/files/owner-coast/rename", {
      name: "Only browser A.jpg",
    });
    expect(
      (await b.read<Files>("/api/views/files")).listing.files.find(
        (f) => f.id === "owner-coast",
      )?.name,
    ).toBe("Coast.jpg");
    await a.scenario("owner");
    expect(
      (await a.read<Files>("/api/views/files")).listing.files.find(
        (f) => f.id === "owner-coast",
      )?.name,
    ).toBe("Coast.jpg");
  });
  it("creates and moves folders and rejects cycles and duplicate names", async () => {
    const client = browser();
    const created = await client.post("/api/files/folders", {
      parentId: "owner-root",
      name: "New folder",
    });
    expect(created.status).toBe(201);
    const { folder } = (await created.json()) as { folder: { id: string } };
    expect(
      (
        await client.post("/api/files/folders", {
          parentId: "owner-root",
          name: "New folder",
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await client.post("/api/files/folders/owner-photos/move", {
          destinationFolderId: "owner-holiday",
        })
      ).status,
    ).toBe(409);
    const moved = await client.post("/api/files/move", {
      destinationFolderId: folder.id,
      items: [{ id: "owner-coast", kind: "file" }],
    });
    expect(await moved.json()).toMatchObject({
      status: "succeeded",
      response: { movedCount: 1, failedCount: 0 },
    });
    expect(
      (
        await client.read<Files>(`/api/views/files/${folder.id}`)
      ).listing.files.map((f) => f.id),
    ).toEqual(["owner-coast"]);
  });
  it("sorts, filters, and pages the same items the file list shows", async () => {
    const client = browser();
    const batch = async (offset: number) => {
      const response = await client.post(
        "/api/views/files/owner-archive/batch",
        {
          query: {
            offset,
            limit: 10,
            sort: "name",
            direction: "desc",
            filter: "image",
            find: "",
          },
        },
      );
      expect(response.status).toBe(200);
      return (await response.json()) as {
        total: number;
        items: Array<{ id: string; data: { name: string } }>;
      };
    };
    const first = await batch(0),
      next = await batch(10);
    expect(first.total).toBeGreaterThan(20);
    expect(first.items).toHaveLength(10);
    expect(next.items.some((i) => first.items.some((f) => f.id === i.id))).toBe(
      false,
    );
    const names = first.items.map((item) => item.data.name);
    expect(names).toEqual(
      [...names].sort((a, b) =>
        b.localeCompare(a, undefined, { numeric: true, sensitivity: "base" }),
      ),
    );
    const selection = await client.post(
      "/api/views/files/owner-archive/selection",
      { query: { filter: "image" } },
    );
    expect(await selection.json()).toMatchObject({
      items: expect.any(Array),
      total: first.total,
    });
  });
  it("updates favorites and pins", async () => {
    const client = browser();
    expect(
      (
        await client.post("/api/files/files/owner-notes/favorite", {
          quickAccessPinned: true,
        })
      ).status,
    ).toBe(200);
    const favorites = await client.post("/api/views/favorites", { query: {} });
    expect(await favorites.json()).toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({
          id: "owner-notes",
          quickAccessPinnedAt: expect.any(String),
        }),
      ]),
    });
    const shell = await client.read<{ info: { pins: Array<{ id: string }> } }>(
      "/api/views/shell",
    );
    expect(shell.info.pins.some((p) => p.id === "owner-notes")).toBe(true);
    await client.post("/api/files/files/owner-notes/favorite", {
      isFavorite: false,
    });
    expect(
      (
        await client.read<{ info: { pins: Array<{ id: string }> } }>(
          "/api/views/shell",
        )
      ).info.pins.some((p) => p.id === "owner-notes"),
    ).toBe(false);
  });
  it("serves actual sample media and partial file bytes", async () => {
    const client = browser();
    for (const [id, mime] of [
      ["coast", "image/jpeg"],
      ["film", "video/mp4"],
      ["audio", "audio/wav"],
      ["guide", "application/pdf"],
      ["notes", "text/markdown"],
    ]) {
      const response = await client.request(
        `/api/files/files/owner-${id}/content`,
      );
      expect(response.headers.get("content-type")).toBe(mime);
      expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(0);
    }
    const range = await client.request("/api/files/files/owner-film/content", {
      headers: { range: "bytes=0-15" },
    });
    expect(range.status).toBe(206);
    expect((await range.arrayBuffer()).byteLength).toBe(16);
    expect(
      (
        await client.request("/api/files/files/owner-film/content", {
          headers: { range: "bytes=999999999-" },
        })
      ).status,
    ).toBe(416);
  });
  it("uploads small files into the shared dataset and releases their bytes on deletion", async () => {
    const client = browser();
    const form = new FormData();
    form.set("folderId", "owner-root");
    form.append(
      "files",
      new File(["sample upload"], "Uploaded.txt", { type: "text/plain" }),
    );
    const response = await client.request("/api/files/files", {
      method: "POST",
      body: form,
    });
    expect(response.status).toBe(201);
    const result = (await response.json()) as {
      uploadedFiles: Array<{ id: string }>;
    };
    const id = result.uploadedFiles[0]!.id;
    expect(
      await (await client.request(`/api/files/files/${id}/content`)).text(),
    ).toBe("sample upload");
    expect(
      (await client.read<Files>("/api/views/files")).listing.files.some(
        (f) => f.id === id,
      ),
    ).toBe(true);
    await client.post(`/api/files/files/${id}/trash`);
    expect((await client.post(`/api/files/files/${id}/delete`)).status).toBe(
      200,
    );
    expect(
      (await client.request(`/api/files/files/${id}/content`)).status,
    ).toBe(404);
  });
  it("handles resumable upload completion and cancellation", async () => {
    const client = browser();
    const response = await client.post("/api/uploads/sessions", {
      originalName: "Chunked.txt",
      mimeType: "text/plain",
      totalSizeBytes: 5,
      folderId: "owner-root",
    });
    expect(response.status).toBe(201);
    const upload = (await response.json()) as { id: string };
    expect(
      (await client.post(`/api/uploads/sessions/${upload.id}/complete`)).status,
    ).toBe(409);
    const chunk = await client.request(`/api/uploads/sessions/${upload.id}`, {
      method: "PATCH",
      headers: { "content-range": "bytes 0-4/5" },
      body: "hello",
    });
    expect(chunk.status).toBe(200);
    const complete = await client.post(
      `/api/uploads/sessions/${upload.id}/complete`,
    );
    expect(complete.status).toBe(201);
    const another = (await (
      await client.post("/api/uploads/sessions", {
        originalName: "Cancelled.txt",
        mimeType: "text/plain",
        totalSizeBytes: 5,
      })
    ).json()) as { id: string };
    expect(
      (
        await client.request(`/api/uploads/sessions/${another.id}`, {
          method: "DELETE",
        })
      ).status,
    ).toBe(204);
    expect(
      (await client.request(`/api/uploads/sessions/${another.id}`)).status,
    ).toBe(404);
  });
  it("creates, unlocks, and revokes public shares without private requests", async () => {
    const client = browser();
    await client.scenario("signed-out");
    expect(await client.read("/s/owner-photo/view")).toMatchObject({
      resolution: { kind: "file", file: { name: "Coast.jpg" } },
    });
    expect(await client.read("/s/owner-locked/view")).toMatchObject({
      resolution: { kind: "locked" },
    });
    expect(
      (await client.post("/s/owner-locked/unlock", { password: "wrong" }))
        .status,
    ).toBe(403);
    expect(
      (
        await client.post("/s/owner-locked/unlock", {
          password: "preview-password",
        })
      ).status,
    ).toBe(200);
    expect((await client.request("/s/owner-locked/content")).status).toBe(200);
    expect(
      (await client.request("/s/owner-folder/files/member-coast/content"))
        .status,
    ).toBe(404);
    await client.scenario("owner");
    const created = await client.post("/api/shares", {
      targetType: "file",
      fileId: "owner-notes",
      mode: "create",
    });
    expect(created.status).toBe(201);
    const { share } = (await created.json()) as {
      share: { id: string; shareUrl: string };
    };
    expect(
      (await client.request(new URL(share.shareUrl).pathname + "/content"))
        .status,
    ).toBe(200);
    await client.post(`/api/shares/${share.id}/revoke`);
    expect(
      (await client.request(new URL(share.shareUrl).pathname + "/content"))
        .status,
    ).toBe(404);
  });
  it("keeps member files private and limits admin controls by role", async () => {
    const client = browser();
    await client.scenario("member");
    expect(
      (await client.read<Files>("/api/views/files")).listing.ownerUserId,
    ).toBe("member");
    expect((await client.request("/api/views/files/owner-root")).status).toBe(
      404,
    );
    expect((await client.request("/api/views/admin/users")).status).toBe(403);
    await client.scenario("admin");
    await client.read("/api/views/admin/users");
    expect((await client.request("/api/views/admin/settings")).status).toBe(
      403,
    );
    expect(
      (await client.post("/api/admin/users", { email: "new@staaash.test" }))
        .status,
    ).toBe(403);
    await client.scenario("signed-out");
    expect((await client.request("/api/views/shell")).status).toBe(401);
    expect(
      (
        await client.post("/api/auth/sign-in", {
          email: "member@staaash.test",
          password: "wrong",
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await client.post("/api/auth/sign-in", {
          email: "member@staaash.test",
          password: "preview-password",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await client.request("/api/auth/sign-out", {
          method: "POST",
          headers: { accept: "text/html" },
        })
      ).status,
    ).toBe(303);
    expect((await client.request("/api/views/shell")).status).toBe(401);
  });
  it("shows empty and failed-job scenarios and lets an owner fix sample jobs", async () => {
    const client = browser();
    await client.scenario("empty");
    expect((await client.read<Files>("/api/views/files")).listing.total).toBe(
      0,
    );
    await client.scenario("error");
    const before = await client.read<
      InferResponseType<typeof api.api.views.admin.jobs.$get, 200>
    >("/api/views/admin/jobs");
    expect(before.initialProblems).toHaveLength(1);
    expect((await client.post("/api/admin/jobs/job-0/retry")).status).toBe(200);
    expect(
      (
        await client.read<
          InferResponseType<typeof api.api.views.admin.jobs.$get, 200>
        >("/api/views/admin/jobs")
      ).initialProblems,
    ).toHaveLength(0);
  });
  it("updates admin users, passwords, and preview jobs in the same fake state", async () => {
    const client = browser();
    const created = await client.post("/api/admin/users", {
      email: "new-admin@staaash.test",
      isAdmin: true,
      generateTemporaryPassword: true,
      storageLimitBytes: "100000",
    });
    expect(created.status).toBe(201);
    const { user } = (await created.json()) as { user: { id: string } };
    const users = await client.read<
      InferResponseType<typeof api.api.views.admin.users.$get, 200>
    >("/api/views/admin/users");
    expect(users.users.find((u) => u.id === user.id)).toMatchObject({
      role: "admin",
      storageLimitBytes: "100000",
    });
    await client.scenario("error");
    const failed = await client.read<
      InferResponseType<typeof api.api.views.admin.jobs.$get, 200>
    >("/api/views/admin/jobs");
    const derivative = failed.initialDerivatives.rows[0]!;
    expect(
      (
        await client.post(
          `/api/admin/derivatives/files/${derivative.fileId}/regenerate`,
        )
      ).status,
    ).toBe(200);
    expect(
      await client.read(`/api/files/files/${derivative.fileId}/derivative`),
    ).toEqual({ status: "ready" });
    await client.scenario("owner");
    expect(
      (
        await client.post("/api/user/password", {
          currentPassword: "preview-password",
          password: "new-preview-password",
          confirmPassword: "new-preview-password",
        })
      ).status,
    ).toBe(200);
    await client.post("/api/auth/sign-out");
    expect(
      (
        await client.post("/api/auth/sign-in", {
          email: "owner@staaash.test",
          password: "new-preview-password",
        })
      ).status,
    ).toBe(200);
  });
  it("streams fake job state and closes the stream when the preview stops", async () => {
    const preview = createPreviewApp();
    const client = browser(preview);
    const response = await client.request("/api/admin/live?jobs=1");
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const reader = response.body!.getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toContain("event: update");
    preview.close();
    await reader.cancel();
  });
  it("provides a sample archive for an anonymous folder share", async () => {
    const client = browser();
    await client.scenario("signed-out");
    const response = await client.request("/s/owner-folder/archive");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/zip");
    expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(0);
  });
  it("finishes setup and invited-user onboarding with sample accounts", async () => {
    const client = browser();
    await client.scenario("setup");
    expect(await client.read("/api/views/entry")).toMatchObject({
      state: "setup",
    });
    expect(
      (
        await client.post("/api/auth/setup", {
          instanceName: "New sample drive",
          email: "new-owner@staaash.test",
          password: "preview-password",
          displayName: "New owner",
        })
      ).status,
    ).toBe(201);
    expect((await client.request("/api/views/shell")).status).toBe(401);
    await client.post("/api/user/preferences", { theme: "dark" });
    expect(await client.read("/api/views/shell")).toMatchObject({
      info: { instanceName: "New sample drive" },
    });
    const response = await client.post("/api/admin/users", {
      email: "invited@staaash.test",
      generateTemporaryPassword: true,
      requirePasswordChange: true,
    });
    const { user } = (await response.json()) as { user: { id: string } };
    expect(
      (
        await client.post(`/api/admin/users/${user.id}/password-reset`, {
          generateTemporaryPassword: true,
          requirePasswordChange: true,
        })
      ).status,
    ).toBe(200);
    await client.post("/api/auth/sign-out");
    expect(await client.read("/api/views/entry")).toMatchObject({
      state: "sign-in",
    });
    expect(
      (
        await client.post("/api/auth/sign-in", {
          email: "invited@staaash.test",
          password: "preview-password",
        })
      ).status,
    ).toBe(200);
    expect(await client.read("/api/views/entry")).toMatchObject({
      firstRun: "password",
    });
    expect(
      (
        await client.post("/api/auth/password-change-required", {
          password: "invited-new-password",
          confirmPassword: "invited-new-password",
        })
      ).status,
    ).toBe(200);
    await client.post("/api/user/preferences", {
      displayName: "Invited member",
    });
    expect(
      (await client.read<Files>("/api/views/files")).listing.ownerUserId,
    ).toBe(user.id);
  });
  it("uses varied photos and matching previews without filling the main drive with copies", async () => {
    const client = browser();
    const files = await client.read<Files>("/api/views/files");
    const ids = [...files.listing.childFolders, ...files.listing.files].map(
      (item) => item.id,
    );
    expect(new Set(ids).size).toBe(ids.length);
    const photos = files.listing.files.filter(
      (file) => file.viewerKind === "image",
    );
    const hashes = new Set<string>();
    for (const photo of photos) {
      const original = await client.request(
        `/api/files/files/${photo.id}/content`,
      );
      const thumbnail = await client.request(
        `/api/files/files/${photo.id}/thumbnail`,
      );
      expect(thumbnail.status).toBe(200);
      const bytes = await thumbnail.arrayBuffer();
      expect(Buffer.from(bytes)).toEqual(
        Buffer.from(await original.arrayBuffer()),
      );
      hashes.add(
        createHash("sha256").update(new Uint8Array(bytes)).digest("hex"),
      );
    }
    expect(hashes.size).toBe(photos.length);
    expect(photos.length).toBeGreaterThanOrEqual(6);
    expect(
      (await client.request("/api/files/files/owner-audio/thumbnail")).status,
    ).toBe(404);
    const video = await client.request("/api/files/files/owner-film/thumbnail");
    expect(video.status).toBe(200);
    expect(
      hashes.has(
        createHash("sha256")
          .update(new Uint8Array(await video.arrayBuffer()))
          .digest("hex"),
      ),
    ).toBe(false);
    expect(
      (await client.read<Files>("/api/views/files/owner-documents")).listing
        .files.length,
    ).toBeGreaterThan(0);
    expect(
      (await client.read<Files>("/api/views/files/owner-archive")).listing
        .total,
    ).toBeGreaterThan(50);
  });
  it("shows password and missing-item states on nested shares", async () => {
    const client = browser();
    await client.scenario("signed-out");
    expect(await client.read("/s/owner-photo/view")).toMatchObject({
      nativeInline: true,
    });
    expect(
      await client.read("/s/owner-locked-folder/view/files/owner-photo-1"),
    ).toEqual({ kind: "locked" });
    await client.post("/s/owner-locked-folder/unlock", {
      password: "preview-password",
    });
    expect(
      await client.read("/s/owner-locked-folder/view/files/owner-photo-1"),
    ).toMatchObject({
      kind: "file",
      file: { id: "owner-photo-1" },
      nativeInline: true,
    });
    expect(
      await client.read("/s/owner-folder/view/files/missing-file"),
    ).toMatchObject({ kind: "error" });
    expect(
      (await client.request("/api/views/viewer/owner-unknown")).status,
    ).toBe(401);
    await client.scenario("owner");
    expect(
      (await client.request("/api/views/viewer/owner-unknown")).status,
    ).toBe(404);
  });
  it("shows recovery screens and lets the admin retry the sample mutation", async () => {
    const client = browser();
    await client.scenario("busy");
    const files = await client.request("/api/views/files/owner-photos");
    expect(files.status).toBe(503);
    expect(await files.json()).toMatchObject({
      code: "STORAGE_RECOVERY_REQUIRED",
    });
    const unavailable = await client.request(
      "/s/owner-folder/storage-unavailable",
    );
    expect(unavailable.status).toBe(503);
    expect(unavailable.headers.get("content-type")).toContain("text/html");
    expect(await unavailable.text()).toContain("Storage operation finishing");
    expect(
      (await client.post("/api/admin/storage/mutations/sample-move/retry"))
        .status,
    ).toBe(200);
    expect((await client.request("/api/views/files/owner-photos")).status).toBe(
      200,
    );
    expect(
      (await client.request("/s/owner-folder/storage-unavailable")).status,
    ).toBe(307);
  });
  it("fails unknown requests locally and rejects cross-origin writes", async () => {
    const client = browser();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const response = await client.request("/api/unknown-sample-path");
      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({
        code: "UI_PREVIEW_UNHANDLED",
      });
      expect(log).toHaveBeenCalledWith(
        expect.stringContaining("Unhandled GET"),
      );
    } finally {
      log.mockRestore();
    }
    expect(
      (
        await client.request("/__ui/scenario", {
          method: "POST",
          headers: { origin: "http://other.test" },
          body: new URLSearchParams({ scenario: "owner" }),
        })
      ).status,
    ).toBe(403);
  });
});
