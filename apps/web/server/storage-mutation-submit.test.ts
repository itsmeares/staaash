import { afterEach, expect, it, vi } from "vite-plus/test";
import {
  followStorageOperation,
  forgetStorageMutationKey,
  isStorageOperation,
  submitStorageMutationPost,
} from "@/src/storage-mutation-submit";

const toast = vi.hoisted(() => ({
  add: vi.fn(() => "emptying"),
  update: vi.fn(),
  close: vi.fn(),
}));
vi.mock("@staaash/ui/components/toast", () => ({ toastManager: toast }));
vi.mock("@/components/confirm-dialog", () => ({
  confirmAction: async () => true,
}));
import { emptyTrash } from "@/src/workspace/trash-moves";

const logicalAction = "trash:folder:retry-test";
const submit = () =>
  submitStorageMutationPost({
    action: "/api/files/folders/retry-test/trash",
    logicalAction,
    headers: { Prefer: "respond-async" },
  });
const queued = {
  operationId: "accepted",
  status: "queued",
  totalCount: 2001,
  doneCount: 0,
};

afterEach(() => {
  forgetStorageMutationKey(logicalAction);
  forgetStorageMutationKey("empty-trash");
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("reuses the accepted request after polling fails, then frees its key after success", async () => {
  vi.useFakeTimers();
  let finished = false;
  const keys: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        keys.push(new Headers(init.headers).get("Idempotency-Key")!);
        return Response.json(queued, { status: 202 });
      }
      if (!finished) throw new TypeError("Network unavailable");
      return Response.json({ ...queued, status: "succeeded", doneCount: 2001 });
    }),
  );
  const first = await submit();
  if (!isStorageOperation(first)) throw new Error("Expected an operation.");
  const lost = expect(followStorageOperation(first, "/status")).rejects.toThrow(
    "lost track",
  );
  await vi.runAllTimersAsync();
  await lost;
  const retried = await submit();
  expect(keys[1]).toBe(keys[0]);
  if (!isStorageOperation(retried)) throw new Error("Expected an operation.");
  finished = true;
  const following = followStorageOperation(retried, "/status");
  await vi.runAllTimersAsync();
  await expect(following).resolves.toMatchObject({ status: "succeeded" });
  await submit();
  expect(keys[2]).not.toBe(keys[0]);
});

it("frees a synchronous request key as soon as it succeeds", async () => {
  const keys: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      keys.push(new Headers(init?.headers).get("Idempotency-Key")!);
      return Response.json({ folder: { id: "retry-test" } });
    }),
  );
  await submit();
  await submit();
  expect(keys[1]).not.toBe(keys[0]);
});

it("Empty trash keeps the accepted key after lost polls and frees it after completion", async () => {
  vi.useFakeTimers();
  let finished = false;
  const keys: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        keys.push(new Headers(init.headers).get("Idempotency-Key")!);
        return Response.json(queued, { status: 202 });
      }
      if (!finished) throw new TypeError("Network unavailable");
      return Response.json({ ...queued, status: "succeeded", doneCount: 2001 });
    }),
  );
  const first = emptyTrash(() => undefined);
  await vi.runAllTimersAsync();
  await first;
  finished = true;
  const retry = emptyTrash(() => undefined);
  await vi.runAllTimersAsync();
  await retry;
  expect(keys[1]).toBe(keys[0]);
  const next = emptyTrash(() => undefined);
  await vi.runAllTimersAsync();
  await next;
  expect(keys[2]).not.toBe(keys[0]);
});
