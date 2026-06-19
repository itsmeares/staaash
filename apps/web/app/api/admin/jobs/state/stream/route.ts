import { createRequire } from "node:module";

import { NextRequest, NextResponse } from "next/server";

import { BACKGROUND_JOB_STATE_CHANGED_CHANNEL } from "@staaash/db/jobs";

import { enforceSameOrigin, requireOwnerApiSession } from "@/server/admin/http";
import {
  getAdminJobStateSnapshot,
  toJsonAdminJobStateSnapshot,
} from "@/server/admin/jobs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HEARTBEAT_MS = 25_000;
const ACTIVE_STATE_CHECK_MS = 1000;
const SNAPSHOT_DEBOUNCE_MS = 50;
const require = createRequire(import.meta.url);

type PgClient = {
  connect(): Promise<void>;
  end(): Promise<void>;
  on(event: "notification", listener: () => void): void;
  query(query: string): Promise<unknown>;
};

const { Client } = require("pg") as {
  Client: new (options: { connectionString: string }) => PgClient;
};

export async function GET(request: NextRequest) {
  const sameOriginError = enforceSameOrigin(request);
  if (sameOriginError) return sameOriginError;

  const auth = await requireOwnerApiSession(request);
  if (!auth.ok) return auth.response;

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    return NextResponse.json(
      { error: "DATABASE_URL is not configured." },
      { status: 500 },
    );
  }

  const encoder = new TextEncoder();
  let cleanup: (() => Promise<void>) | null = null;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      let lastPayload = "";
      let snapshotInFlight = false;
      let snapshotQueued = false;
      let snapshotTimer: ReturnType<typeof setTimeout> | null = null;
      let activeStateTimer: ReturnType<typeof setInterval> | null = null;
      let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
      const pgClient = new Client({ connectionString: databaseUrl });

      const cleanupResources = async () => {
        if (closed) return;
        closed = true;
        if (snapshotTimer) clearTimeout(snapshotTimer);
        if (activeStateTimer) clearInterval(activeStateTimer);
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        request.signal.removeEventListener("abort", onAbort);
        await pgClient.end().catch(() => undefined);
      };

      const close = async () => {
        await cleanupResources();
        try {
          controller.close();
        } catch {
          // stream may already be closed by client disconnect
        }
      };

      const sendSnapshot = async () => {
        if (closed) return;
        if (snapshotInFlight) {
          snapshotQueued = true;
          return;
        }
        snapshotInFlight = true;
        snapshotQueued = false;
        try {
          const snapshot = await getAdminJobStateSnapshot();
          const state = toJsonAdminJobStateSnapshot(snapshot);
          const hasDueOrRunningWork =
            state.summary.statusCounts.running > 0 ||
            state.summary.oldestDueQueuedAgeSeconds !== null;

          if (hasDueOrRunningWork && !activeStateTimer) {
            activeStateTimer = setInterval(
              scheduleSnapshot,
              ACTIVE_STATE_CHECK_MS,
            );
          } else if (!hasDueOrRunningWork && activeStateTimer) {
            clearInterval(activeStateTimer);
            activeStateTimer = null;
          }

          const payload = JSON.stringify(state);
          if (payload === lastPayload) return;
          lastPayload = payload;
          controller.enqueue(
            encoder.encode(`event: state\ndata: ${payload}\n\n`),
          );
        } finally {
          snapshotInFlight = false;
          if (snapshotQueued) {
            scheduleSnapshot();
          }
        }
      };

      const scheduleSnapshot = () => {
        if (closed || snapshotTimer) return;
        snapshotTimer = setTimeout(() => {
          snapshotTimer = null;
          void sendSnapshot().catch(() => undefined);
        }, SNAPSHOT_DEBOUNCE_MS);
      };

      const onAbort = () => {
        void close();
      };

      cleanup = close;

      try {
        await pgClient.connect();
        await pgClient.query(`LISTEN ${BACKGROUND_JOB_STATE_CHANGED_CHANNEL}`);
        pgClient.on("notification", scheduleSnapshot);
        request.signal.addEventListener("abort", onAbort, { once: true });

        await sendSnapshot();
        heartbeatTimer = setInterval(() => {
          if (!closed) controller.enqueue(encoder.encode(": keep-alive\n\n"));
        }, HEARTBEAT_MS);
      } catch (error) {
        await cleanupResources();
        controller.error(error);
      }
    },
    async cancel() {
      await cleanup?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream; charset=utf-8",
      "X-Accel-Buffering": "no",
    },
  });
}
