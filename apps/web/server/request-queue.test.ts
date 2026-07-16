import { afterEach, describe, expect, it, vi } from "vitest";

import { queuedXhrUpload } from "@/lib/transfers/request-queue";

class MockXMLHttpRequest {
  static instances: MockXMLHttpRequest[] = [];

  upload: Pick<XMLHttpRequestUpload, "onprogress"> = { onprogress: null };
  onload: XMLHttpRequest["onload"] = null;
  onerror: XMLHttpRequest["onerror"] = null;
  onabort: XMLHttpRequest["onabort"] = null;
  status = 200;
  responseText = '{"receivedBytes":10}';
  method = "";
  url = "";
  headers = new Map<string, string>();

  constructor() {
    MockXMLHttpRequest.instances.push(this);
  }

  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }

  setRequestHeader(name: string, value: string) {
    this.headers.set(name, value);
  }

  send() {
    const onProgress = this.upload.onprogress as
      ((event: ProgressEvent) => void) | null;
    const onLoad = this.onload as ((event: ProgressEvent) => void) | null;
    onProgress?.({
      lengthComputable: true,
      loaded: 5,
      total: 10,
    } as ProgressEvent);
    onLoad?.({} as ProgressEvent);
  }

  abort() {
    const onAbort = this.onabort as ((event: ProgressEvent) => void) | null;
    onAbort?.({} as ProgressEvent);
  }
}

const originalXMLHttpRequest = globalThis.XMLHttpRequest;

afterEach(() => {
  MockXMLHttpRequest.instances = [];
  globalThis.XMLHttpRequest = originalXMLHttpRequest;
});

describe("queuedXhrUpload", () => {
  it("supports PATCH requests and reports live upload progress", async () => {
    globalThis.XMLHttpRequest =
      MockXMLHttpRequest as unknown as typeof XMLHttpRequest;
    const onProgress = vi.fn();

    const result = await queuedXhrUpload({
      url: "/api/uploads/sessions/session-1",
      method: "PATCH",
      body: new ArrayBuffer(10),
      headers: { "Content-Range": "bytes 0-9/10" },
      onProgress,
    });

    const xhr = MockXMLHttpRequest.instances[0];
    expect(xhr.method).toBe("PATCH");
    expect(xhr.url).toBe("/api/uploads/sessions/session-1");
    expect(xhr.headers.get("Content-Range")).toBe("bytes 0-9/10");
    expect(onProgress).toHaveBeenCalledWith(5, 10);
    expect(result).toEqual({
      status: 200,
      responseText: '{"receivedBytes":10}',
    });
  });
});
