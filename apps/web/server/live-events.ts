import { createRequire } from "node:module";

import { UPDATE_STATE_CHANGED_CHANNEL } from "@staaash/db/instance";
import { BACKGROUND_JOB_STATE_CHANGED_CHANNEL } from "@staaash/db/jobs";

export type LiveChannel = "jobs" | "updates";

type PgClient = {
  connect(): Promise<void>;
  end(): Promise<void>;
  on(
    event: "notification",
    listener: (message: { channel: string }) => void,
  ): void;
  on(event: "error" | "end", listener: () => void): void;
  query(query: string): Promise<unknown>;
};

const require = createRequire(import.meta.url);
const { Client } = require("pg") as {
  Client: new (options: { connectionString: string }) => PgClient;
};

const CHANNELS: Record<string, LiveChannel> = {
  [BACKGROUND_JOB_STATE_CHANGED_CHANNEL]: "jobs",
  [UPDATE_STATE_CHANGED_CHANNEL]: "updates",
};
const RECONNECT_MS = 2000;

type Listener = (channel: LiveChannel) => void;

// One LISTEN connection per server process, shared by every open stream.
// Kept on globalThis so dev reloads do not leak connections.
const live = ((
  globalThis as {
    __staaashLive?: {
      client: PgClient | null;
      connecting: Promise<void> | null;
      listeners: Set<Listener>;
    };
  }
).__staaashLive ??= { client: null, connecting: null, listeners: new Set() });

const connect = async () => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is not configured.");
  const client = new Client({ connectionString: databaseUrl });
  const drop = () => {
    if (live.client !== client) return;
    live.client = null;
    client.end().catch(() => undefined);
    // Streams stay open; reconnect while anyone is listening.
    if (live.listeners.size > 0) {
      setTimeout(
        () => void ensureConnected().catch(() => undefined),
        RECONNECT_MS,
      );
    }
  };
  client.on("error", drop);
  client.on("end", drop);
  client.on("notification", ({ channel }) => {
    const name = CHANNELS[channel];
    if (name) for (const listener of live.listeners) listener(name);
  });
  await client.connect();
  for (const channel of Object.keys(CHANNELS)) {
    await client.query(`LISTEN ${channel}`);
  }
  live.client = client;
};

const ensureConnected = async () => {
  if (live.client) return;
  live.connecting ??= connect().finally(() => {
    live.connecting = null;
  });
  await live.connecting;
};

/** Calls `listener` for each job or update change until the returned function runs. */
export const subscribeLiveEvents = async (listener: Listener) => {
  live.listeners.add(listener);
  try {
    await ensureConnected();
  } catch (error) {
    live.listeners.delete(listener);
    throw error;
  }
  return () => {
    live.listeners.delete(listener);
  };
};
