import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vite-plus/test";

import { toast } from "@staaash/ui/components/toast";
import { showMoveFailure } from "@/src/workspace/files/move-notifications";

vi.mock("@staaash/ui/components/toast", () => ({
  toast: { error: vi.fn() },
}));

const prefix = "staaash:move-dismissal:";
const day = 24 * 60 * 60 * 1_000;
const saved = new Map<string, string>();

const closeWarning = () => {
  const options = vi.mocked(toast.error).mock.lastCall?.[1];
  expect(options?.onClose).toBeTypeOf("function");
  options?.onClose?.();
};

describe("move warning dismissal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    saved.clear();
    vi.useFakeTimers();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => saved.get(key) ?? null,
      setItem: (key: string, value: string) => saved.set(key, value),
      removeItem: (key: string) => saved.delete(key),
      key: (index: number) => [...saved.keys()][index] ?? null,
      get length() {
        return saved.size;
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("only remembers an explicit close and keeps another move visible", () => {
    showMoveFailure("Name taken.", { operationId: "move-1" });
    expect(saved.size).toBe(0);
    closeWarning();

    showMoveFailure("Name taken.", { operationId: "move-1" });
    expect(toast.error).toHaveBeenCalledTimes(1);
    showMoveFailure("Name taken.", { operationId: "another-account-move" });
    expect(toast.error).toHaveBeenCalledTimes(2);
    expect([...saved.keys()]).toEqual([`${prefix}move-1:succeeded`]);
  });

  it("expires completed results without removing other browser data", () => {
    saved.set("unrelated", "keep");
    showMoveFailure("Name taken.", { operationId: "move-1" });
    closeWarning();
    vi.advanceTimersByTime(day + 1);

    showMoveFailure("Another failure.", { operationId: "move-2" });
    expect([...saved.entries()]).toEqual([["unrelated", "keep"]]);
  });

  it("keeps a recovery dismissal until the failure state changes", () => {
    const operation = {
      operationId: "move-1",
      status: "recovery_required" as const,
    };
    showMoveFailure("Check the files.", operation);
    closeWarning();
    vi.advanceTimersByTime(day * 2);
    showMoveFailure("Check the files.", operation);
    expect(toast.error).toHaveBeenCalledTimes(1);

    showMoveFailure("Some items still failed.", { operationId: "move-1" });
    expect(toast.error).toHaveBeenCalledTimes(2);
  });

  it("keeps Retry available and reports its new failed operation", () => {
    const retry = vi.fn();
    showMoveFailure("Name taken.", { operationId: "move-1", retry });
    vi.mocked(toast.error).mock.lastCall?.[1]?.retry?.();
    closeWarning();
    expect(retry).toHaveBeenCalledOnce();
    showMoveFailure("Name still taken.", { operationId: "move-retry", retry });
    expect(toast.error).toHaveBeenCalledTimes(2);
  });

  it("uses a failed move's identity when another workspace page reports it", () => {
    showMoveFailure(
      new Error("Check the files.", {
        cause: { operationId: "move-1", status: "recovery_required" },
      }),
    );
    closeWarning();
    showMoveFailure("Check the files.", {
      operationId: "move-1",
      status: "recovery_required",
    });
    expect(toast.error).toHaveBeenCalledTimes(1);
  });

  it("ignores corrupt saved values and keeps the warning usable without storage", () => {
    saved.set(`${prefix}move-1:succeeded`, "invalid");
    showMoveFailure("Name taken.", { operationId: "move-1" });
    expect(toast.error).toHaveBeenCalledOnce();
    expect(saved.size).toBe(0);

    vi.stubGlobal("localStorage", undefined);
    expect(() =>
      showMoveFailure("Name taken.", { operationId: "move-2" }),
    ).not.toThrow();
    expect(closeWarning).not.toThrow();
    expect(toast.error).toHaveBeenCalledTimes(2);
  });

  it("does not save request failures without a durable move ID", () => {
    showMoveFailure("Could not reach the server.");
    expect(vi.mocked(toast.error).mock.lastCall?.[1]?.onClose).toBeUndefined();
    expect(saved.size).toBe(0);
  });
});
