import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { hc, type ClientResponse } from "hono/client";

import { ApiError, read } from "@/lib/api";
import type { AppType } from "@/server/http/app";

export { ApiError };

/** The device token stopped working: signed out from the web app, or revoked. */
export class SignedOutError extends Error {}

const RETRIES = 5;

const retryDelay = (response: Response | null, attempt: number) => {
  const header = Number(response?.headers.get("retry-after"));
  const seconds = Number.isFinite(header) && header > 0 ? header : 2 ** attempt;
  return Math.min(seconds, 60) * 1000;
};

/**
 * Retries a busy server (503 with Retry-After) and dropped connections. Every
 * storage write carries an Idempotency-Key, so a retry replays the first
 * attempt instead of repeating it.
 */
// Retry rules for busy, dropped and signed-out replies.
// fallow-ignore-next-line complexity
const retryingFetch = async (
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> => {
  for (let attempt = 0; ; attempt += 1) {
    let response: Response | null = null;
    try {
      response = await fetch(input, init);
    } catch (error) {
      if (attempt >= RETRIES || init?.signal?.aborted) throw error;
    }
    if (response && response.status !== 503) {
      if (response.status === 401) throw new SignedOutError("Signed out.");
      return response;
    }
    if (response && attempt >= RETRIES) return response;
    await sleep(retryDelay(response, attempt));
  }
};

export type Api = ReturnType<typeof createApi>;

/** A file as rename, move and trash answer with it. */
type FileMutation = {
  file: {
    id: string;
    folderId: string | null;
    name: string;
    sizeBytes: number;
    storageRevision?: number;
    clientModifiedAt?: string | null;
  };
};

/** Every call the sync engine makes, signed in with the device token. */
export const createApi = (serverUrl: string, token: string) => {
  const headers = { authorization: `Bearer ${token}` };
  const client = hc<AppType>(serverUrl, { headers, fetch: retryingFetch });
  const write = () => ({
    headers: { ...headers, "idempotency-key": randomUUID() },
  });
  const revision = (ifRevision: number | null) =>
    ifRevision === null ? {} : { ifRevision: String(ifRevision) };
  const raw = (path: string, init: RequestInit = {}) => {
    const merged = new Headers(init.headers);
    merged.set("authorization", headers.authorization);
    return retryingFetch(new URL(path, serverUrl), {
      ...init,
      headers: merged,
    });
  };

  const fileMutation = async (
    path: string,
    ifRevision: number,
    body: Record<string, unknown> | null,
  ) => {
    const url = `${path}?ifRevision=${ifRevision}`;
    const response = await raw(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": randomUUID(),
      },
      body: JSON.stringify(body ?? {}),
    });
    return read(
      Promise.resolve(
        response as unknown as ClientResponse<FileMutation, 200, "json">,
      ),
    );
  };

  return {
    session: () => read(client.api.auth.session.$get()),
    folders: () => read(client.api.files.folders.tree.$get()),
    snapshot: (folderId: string | null, cursor: string | null) =>
      read(
        client.api.sync.snapshot.$get({
          query: {
            ...(folderId ? { folderId } : {}),
            ...(cursor ? { cursor } : {}),
            limit: "5000",
          },
        }),
      ),
    changes: (after: string) =>
      read(client.api.sync.changes.$get({ query: { after, limit: "1000" } })),
    createFolder: (parentId: string, name: string) =>
      read(
        client.api.files.folders.$post({ json: { parentId, name } }, write()),
      ),
    // The typed client merges these paths with a pattern route, so they go
    // through plain requests with the server's documented FileMutation shape.
    moveFile: (
      fileId: string,
      ifRevision: number,
      destinationFolderId: string,
    ) =>
      fileMutation(`/api/files/files/${fileId}/move`, ifRevision, {
        destinationFolderId,
      }),
    renameFile: (fileId: string, ifRevision: number, name: string) =>
      fileMutation(`/api/files/files/${fileId}/rename`, ifRevision, { name }),
    trashFile: (fileId: string, ifRevision: number) =>
      fileMutation(`/api/files/files/${fileId}/trash`, ifRevision, null),
    moveFolder: (
      folderId: string,
      ifRevision: number,
      destinationFolderId: string,
    ) =>
      read(
        client.api.files.folders[":folderId"].move.$post(
          {
            param: { folderId },
            query: revision(ifRevision),
            json: { destinationFolderId },
          },
          write(),
        ),
      ),
    renameFolder: (folderId: string, ifRevision: number, name: string) =>
      read(
        client.api.files.folders[":folderId"].rename.$post(
          { param: { folderId }, query: revision(ifRevision), json: { name } },
          write(),
        ),
      ),
    trashFolder: (folderId: string, ifRevision: number) =>
      read(
        client.api.files.folders[":folderId"].trash.$post(
          { param: { folderId }, query: revision(ifRevision) },
          write(),
        ),
      ),
    keepMine: (fileId: string, ifRevision: number, conflictCopyId: string) =>
      read(
        client.api.sync.conflicts["keep-mine"].$post(
          { json: { fileId, ifRevision, conflictCopyId } },
          write(),
        ),
      ),
    startUpload: (input: {
      folderId: string;
      name: string;
      size: number;
      checksum: string;
      modifiedAt: number;
      replace: boolean;
    }) =>
      read(
        client.api.uploads.sessions.$post(
          {
            json: {
              folderId: input.folderId,
              originalName: input.name,
              mimeType: "application/octet-stream",
              totalSizeBytes: input.size,
              conflictStrategy: input.replace ? "replace" : "fail",
              expectedChecksum: input.checksum,
              clientModifiedAt: new Date(input.modifiedAt).toISOString(),
            },
          },
          write(),
        ),
      ),
    uploadStatus: (id: string) =>
      read(client.api.uploads.sessions[":id"].$get({ param: { id } })),
    cancelUpload: (id: string) =>
      read(client.api.uploads.sessions[":id"].$delete({ param: { id } })),
    /** `end` is inclusive, as in Content-Range. */
    uploadChunk: async (
      id: string,
      start: number,
      body: Buffer,
      total: number,
    ) => {
      const response = await raw(`/api/uploads/sessions/${id}`, {
        method: "PATCH",
        headers: {
          "content-type": "application/octet-stream",
          "content-range": `bytes ${start}-${start + body.length - 1}/${total}`,
        },
        body: new Uint8Array(body),
      });
      if (!response.ok) await read(Promise.resolve(response as never));
    },
    completeUpload: (id: string, checksum: string, ifRevision: number | null) =>
      read(
        client.api.uploads.sessions[":id"].complete.$post(
          {
            param: { id },
            json: {
              expectedChecksum: checksum,
              ...(ifRevision === null ? {} : { ifRevision }),
            },
          },
          write(),
        ),
      ),
    /** Zero-byte files; upload sessions need at least one byte. */
    download: async (fileId: string, signal?: AbortSignal) => {
      const response = await raw(`/api/files/files/${fileId}/download`, {
        signal,
      });
      if (!response.ok || !response.body) {
        await read(Promise.resolve(response as never));
        throw new ApiError(response.status, "Download failed.");
      }
      return response.body;
    },
    /** The server's push channel; resolves when the stream ends. */
    events: async (onChange: () => void, signal: AbortSignal) => {
      const response = await fetch(new URL("/api/sync/events", serverUrl), {
        headers: { ...headers, accept: "text/event-stream" },
        signal,
      });
      if (response.status === 401) throw new SignedOutError("Signed out.");
      if (!response.ok || !response.body) {
        throw new ApiError(response.status, "Live updates are unavailable.");
      }
      const decoder = new TextDecoder();
      let buffer = "";
      for await (const chunk of response.body) {
        buffer += decoder.decode(chunk, { stream: true });
        let end;
        while ((end = buffer.indexOf("\n\n")) !== -1) {
          const message = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          if (/^data:/m.test(message)) onChange();
        }
      }
    },
  };
};

/** Server facts that need no sign-in: the version check before anything else. */
export const fetchVersion = async (serverUrl: string) => {
  const response = await fetch(new URL("/api/version", serverUrl), {
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new ApiError(response.status, "This is not a Staaash server.");
  }
  return (await response.json()) as {
    version: string;
    minClientVersion: string;
  };
};
