import { NextRequest } from "next/server";

import { enforceSameOrigin, requireOwnerApiSession } from "@/server/admin/http";
import {
  getAdminJobStateSnapshot,
  toJsonAdminJobStateSnapshot,
} from "@/server/admin/jobs";
import { getUpdateState } from "@/server/admin/updates";
import { subscribeLiveEvents } from "@/server/live-events";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HEARTBEAT_MS = 25_000;
const ACTIVE_STATE_CHECK_MS = 1000;
const SNAPSHOT_DEBOUNCE_MS = 50;

/**
 * The owner pages' live stream: `update` events on every page, and `state`
 * events with the job queue when the Jobs page asks with ?jobs=1.
 */
export async function GET(request: NextRequest) {
  const sameOriginError = enforceSameOrigin(request);
  if (sameOriginError) return sameOriginError;

  const auth = await requireOwnerApiSession(request);
  if (!auth.ok) return auth.response;

  const wantsJobs = request.nextUrl.searchParams.get("jobs") === "1";
  const encoder = new TextEncoder();
  let cleanup: (() => void) | null = null;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      let lastState = "";
      let lastUpdate = "";
      let stateInFlight = false;
      let stateQueued = false;
      let stateTimer: ReturnType<typeof setTimeout> | null = null;
      let activeTimer: ReturnType<typeof setInterval> | null = null;
      let heartbeat: ReturnType<typeof setInterval> | null = null;
      let unsubscribe: (() => void) | null = null;

      const send = (event: string, data: string) => {
        if (!closed)
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${data}\n\n`),
          );
      };

      const sendUpdate = async () => {
        const payload = JSON.stringify(await getUpdateState());
        if (payload === lastUpdate) return;
        lastUpdate = payload;
        send("update", payload);
      };

      const sendState = async () => {
        if (closed) return;
        if (stateInFlight) {
          stateQueued = true;
          return;
        }
        stateInFlight = true;
        stateQueued = false;
        try {
          const state = toJsonAdminJobStateSnapshot(
            await getAdminJobStateSnapshot(),
          );
          // While work is due or running, progress changes without a notify.
          const busy =
            state.summary.statusCounts.running > 0 ||
            state.summary.oldestDueQueuedAgeSeconds !== null;
          if (busy && !activeTimer) {
            activeTimer = setInterval(scheduleState, ACTIVE_STATE_CHECK_MS);
          } else if (!busy && activeTimer) {
            clearInterval(activeTimer);
            activeTimer = null;
          }
          const payload = JSON.stringify(state);
          if (payload === lastState) return;
          lastState = payload;
          send("state", payload);
        } finally {
          stateInFlight = false;
          if (stateQueued) scheduleState();
        }
      };

      const scheduleState = () => {
        if (closed || stateTimer) return;
        stateTimer = setTimeout(() => {
          stateTimer = null;
          void sendState().catch(() => undefined);
        }, SNAPSHOT_DEBOUNCE_MS);
      };

      const close = () => {
        if (closed) return;
        closed = true;
        if (stateTimer) clearTimeout(stateTimer);
        if (activeTimer) clearInterval(activeTimer);
        if (heartbeat) clearInterval(heartbeat);
        unsubscribe?.();
        request.signal.removeEventListener("abort", close);
        try {
          controller.close();
        } catch {
          // already closed by the client
        }
      };
      cleanup = close;

      try {
        unsubscribe = await subscribeLiveEvents((channel) => {
          if (channel === "updates") void sendUpdate().catch(() => undefined);
          else if (wantsJobs) scheduleState();
        });
        request.signal.addEventListener("abort", close, { once: true });
        await sendUpdate();
        if (wantsJobs) await sendState();
        heartbeat = setInterval(() => {
          if (!closed) controller.enqueue(encoder.encode(": keep-alive\n\n"));
        }, HEARTBEAT_MS);
      } catch (error) {
        close();
        controller.error(error);
      }
    },
    cancel() {
      cleanup?.();
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
