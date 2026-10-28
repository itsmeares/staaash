/// <reference types="electron" />
import { mkdirSync } from "node:fs";

import watcher from "@parcel/watcher";

import type { EngineCommand, EngineEvent } from "../shared/types";
import { SyncEngine } from "./engine";

/**
 * The sync engine's own process: plain Node, started by the main process as
 * an Electron utility process, so a busy sync never stalls the tray.
 */
const port = process.parentPort;
const emit = (event: EngineEvent) => port.postMessage(event);

let nextRequest = 0;
const waiting = new Map<number, (error: string | null) => void>();

// The main process passes the data folder, which outlives every engine run.
const [dataDir] = process.argv.slice(-1);
mkdirSync(dataDir, { recursive: true });

const engine = new SyncEngine(
  {
    emit,
    // Electron's shell.trashItem only exists in the main process.
    trash: (file) =>
      new Promise((resolve, reject) => {
        const requestId = (nextRequest += 1);
        waiting.set(requestId, (error) =>
          error ? reject(new Error(error)) : resolve(),
        );
        emit({ type: "trash", requestId, path: file });
      }),
    watch: async (dir, onChange) => {
      const subscription = await watcher.subscribe(dir, (error) => {
        if (!error) onChange();
      });
      return () => void subscription.unsubscribe();
    },
  },
  dataDir,
);

// One branch per command.
// fallow-ignore-next-line complexity
port.on("message", ({ data }: { data: EngineCommand }) => {
  switch (data.type) {
    case "configure":
      void engine.configure(data.config);
      return;
    case "sync-now":
      engine.request();
      return;
    case "resolve-conflict":
      void engine.resolveConflict(data.id, data.choice);
      return;
    case "resolve-pair":
      engine.resolvePair(data.pairId, data.choice);
      return;
    case "forget-pair":
      engine.forgetPair(data.pairId);
      return;
    case "trashed":
      waiting.get(data.requestId)?.(data.error);
      waiting.delete(data.requestId);
      return;
  }
});

process.on("exit", () => void engine.stop());
