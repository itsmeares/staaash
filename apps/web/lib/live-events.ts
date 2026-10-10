"use client";

import type { UpdateState } from "@/lib/update-status";

type Events = {
  update: UpdateState;
  // The Jobs page's snapshot; its shape is owned by the jobs view.
  state: unknown;
};

type Listener<K extends keyof Events> = (data: Events[K]) => void;

const listeners = {
  update: new Set<Listener<"update">>(),
  state: new Set<Listener<"state">>(),
};
let source: EventSource | null = null;
let sourceWithJobs = false;

// One EventSource per tab. It asks for job state only while something
// listens for it, and reconnects when that changes.
const sync = () => {
  const wanted = listeners.update.size + listeners.state.size > 0;
  const withJobs = listeners.state.size > 0;
  if (source && (!wanted || withJobs !== sourceWithJobs)) {
    source.close();
    source = null;
  }
  if (!wanted || source) return;
  sourceWithJobs = withJobs;
  source = new EventSource(`/api/admin/live${withJobs ? "?jobs=1" : ""}`);
  for (const event of ["update", "state"] as const) {
    source.addEventListener(event, (message) => {
      const data = JSON.parse((message as MessageEvent<string>).data);
      for (const listener of listeners[event])
        (listener as Listener<typeof event>)(data);
    });
  }
};

if (typeof document !== "undefined") {
  // A tab coming back may have missed events while its stream was closed.
  document.addEventListener("visibilitychange", () => {
    if (
      document.visibilityState === "visible" &&
      source?.readyState === EventSource.CLOSED
    ) {
      source = null;
      sync();
    }
  });
}

/** Owner pages only: the server refuses the stream for everyone else. */
export function subscribeLive<K extends keyof Events>(
  event: K,
  listener: Listener<K>,
) {
  (listeners[event] as Set<Listener<K>>).add(listener);
  sync();
  return () => {
    (listeners[event] as Set<Listener<K>>).delete(listener);
    sync();
  };
}
