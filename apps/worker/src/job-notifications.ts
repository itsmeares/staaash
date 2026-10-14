import { getPostgresPool, type PostgresPoolClient } from "@staaash/db/client";
import { BACKGROUND_JOB_STATE_CHANGED_CHANNEL } from "@staaash/db/jobs";

import { getErrorMessage } from "./job-context.js";

export class JobNotifications {
  private client: PostgresPoolClient | null = null;
  private connecting = false;
  private closed = false;

  constructor(private readonly wake: () => void) {}

  connect() {
    if (this.closed || this.client || this.connecting) return;
    this.connecting = true;
    // Connection trouble must not block claims; the next poll retries LISTEN.
    void this.listen()
      .catch((error) => {
        console.warn(
          "[worker] Job notifications unavailable; polling continues.",
          {
            error: getErrorMessage(error),
          },
        );
      })
      .finally(() => {
        this.connecting = false;
      });
  }

  close() {
    this.closed = true;
    const client = this.client;
    this.client = null;
    // Destroy the session so LISTEN never leaks into a pooled query connection.
    client?.release(true);
  }

  private async listen() {
    const client = await getPostgresPool().connect();
    if (this.closed) {
      client.release(true);
      return;
    }
    this.client = client;
    const disconnect = () => {
      if (this.client !== client) return;
      this.client = null;
      client.release(true);
    };
    client.on("error", (error) => {
      console.warn(
        "[worker] Job notification connection lost; polling continues.",
        {
          error: getErrorMessage(error),
        },
      );
      disconnect();
    });
    client.on("end", disconnect);
    client.on("notification", ({ channel }) => {
      if (
        this.client === client &&
        channel === BACKGROUND_JOB_STATE_CHANGED_CHANNEL
      ) {
        this.wake();
      }
    });

    try {
      await client.query(`LISTEN ${BACKGROUND_JOB_STATE_CHANGED_CHANNEL}`);
      // Recheck the queue after LISTEN commits, including jobs queued while connecting.
      if (this.client === client) this.wake();
    } catch (error) {
      disconnect();
      throw error;
    }
  }
}
