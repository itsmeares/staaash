import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import path from "node:path";
import {
  ipcMain,
  shell,
  type DownloadItem,
  type IpcMainInvokeEvent,
  type WebContents,
} from "electron";

import type { BrowserDownload } from "@staaash/config/desktop-downloads";

type Entry = {
  info: BrowserDownload;
  item: DownloadItem | null;
  path: string;
};

export class BrowserDownloads {
  private readonly entries = new Map<string, Entry>();
  private contents: WebContents | null = null;
  private origin = "";
  private detach: (() => void) | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  get activeCount() {
    return [...this.entries.values()].filter((entry) => entry.item).length;
  }

  private snapshot() {
    return [...this.entries.values()].map((entry) => ({ ...entry.info }));
  }

  private publish(immediate = false) {
    if (!immediate) {
      this.timer ??= setTimeout(() => this.publish(true), 250);
      return;
    }
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const contents = this.viewer();
    if (contents) contents.send("downloads:changed", this.snapshot());
  }

  private viewer() {
    const contents = this.contents;
    if (!contents || contents.isDestroyed()) return null;
    return URL.parse(contents.getURL())?.origin === this.origin
      ? contents
      : null;
  }

  register() {
    const handle = (channel: string, run: (id: unknown) => unknown) =>
      ipcMain.handle(channel, (event, id: unknown) => {
        if (!this.owns(event)) throw new Error("Download access denied.");
        return run(id);
      });
    handle("downloads:state", () => this.snapshot());
    handle("downloads:clear", () => {
      for (const [id, entry] of this.entries)
        if (!entry.item) this.entries.delete(id);
      this.publish(true);
      return { error: null };
    });
    handle("downloads:cancel", (id) => this.cancel(id));
    handle("downloads:resume", (id) => this.resume(id));
    handle("downloads:reveal", (id) => this.reveal(id));
  }

  private owns(event: IpcMainInvokeEvent) {
    return (
      this.viewer() !== null &&
      this.contents !== null &&
      event.sender === this.contents &&
      event.senderFrame === this.contents.mainFrame &&
      URL.parse(event.senderFrame.url)?.origin === this.origin
    );
  }

  attach(contents: WebContents, origin: string) {
    this.detach?.();
    if (this.origin && this.origin !== origin) this.reset();
    this.contents = contents;
    this.origin = origin;
    const session = contents.session;
    const started = (
      _event: Electron.Event,
      item: DownloadItem,
      source: WebContents,
    ) => {
      if (
        source === contents &&
        URL.parse(contents.getURL())?.origin === origin
      )
        this.track(item);
    };
    // A web sign-out must not leave the previous account's filenames visible.
    const navigated = (_event: Electron.Event, url: string) => {
      const pathname = URL.parse(url)?.pathname;
      if (pathname === "/" || pathname === "/api/auth/sign-out") this.reset();
    };
    session.on("will-download", started);
    contents.on("will-navigate", navigated);
    contents.on("did-navigate", navigated);
    const detach = () => {
      session.off("will-download", started);
      contents.off("will-navigate", navigated);
      contents.off("did-navigate", navigated);
      contents.off("destroyed", detach);
      if (this.contents === contents) this.contents = null;
    };
    contents.once("destroyed", detach);
    this.detach = detach;
  }

  private track(item: DownloadItem) {
    const id = randomUUID();
    const entry: Entry = {
      info: {
        id,
        name: item.getFilename(),
        mimeType: item.getMimeType(),
        receivedBytes: 0,
        totalBytes: null,
        state: "selecting",
        canResume: false,
      },
      item,
      path: "",
    };
    this.entries.set(id, entry);
    const read = () => {
      entry.path = item.getSavePath();
      entry.info.name = entry.path
        ? path.basename(entry.path)
        : item.getFilename();
      entry.info.receivedBytes = item.getReceivedBytes();
      entry.info.totalBytes = item.getTotalBytes() || null;
      entry.info.canResume = item.canResume();
    };
    const updated = (_event: Electron.Event, state: string) => {
      read();
      entry.info.state =
        state === "interrupted"
          ? "interrupted"
          : entry.path
            ? "downloading"
            : "selecting";
      this.publish();
    };
    item.on("updated", updated);
    item.once("done", (_event, state) => {
      item.off("updated", updated);
      read();
      entry.item = null;
      entry.info.canResume = false;
      entry.info.state =
        state === "completed"
          ? "completed"
          : state === "cancelled"
            ? "cancelled"
            : "failed";
      if (state === "cancelled" && !entry.path) this.entries.delete(id);
      const finished = [...this.entries].filter(([, record]) => !record.item);
      for (const [oldId] of finished.slice(
        0,
        Math.max(0, finished.length - 50),
      ))
        this.entries.delete(oldId);
      this.publish(true);
    });
    this.publish(true);
  }

  private find(id: unknown) {
    return typeof id === "string" ? this.entries.get(id) : undefined;
  }

  private cancel(id: unknown) {
    const item = this.find(id)?.item;
    if (!item) return { error: "That download is no longer active." };
    item.cancel();
    return { error: null };
  }

  private resume(id: unknown) {
    const item = this.find(id)?.item;
    if (!item?.canResume()) return { error: "That download cannot resume." };
    item.resume();
    return { error: null };
  }

  private async reveal(id: unknown) {
    const entry = this.find(id);
    if (entry?.info.state !== "completed")
      return { error: "That download is no longer in the list." };
    try {
      if (!(await stat(entry.path)).isFile())
        return { error: "The downloaded file is no longer there." };
      if (this.entries.get(entry.info.id) !== entry)
        return { error: "That download is no longer in the list." };
      shell.showItemInFolder(entry.path);
      return { error: null };
    } catch {
      return { error: "The downloaded file is no longer there." };
    }
  }

  reset() {
    for (const entry of this.entries.values()) entry.item?.cancel();
    this.entries.clear();
    this.publish(true);
  }
}
