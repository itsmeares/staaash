import { afterEach, expect, it, vi } from "vite-plus/test";

const toast = vi.hoisted(() => ({
  add: vi.fn(() => "progress"),
  update: vi.fn(),
  close: vi.fn(),
}));
vi.mock("@staaash/ui/components/toast", () => ({ toastManager: toast }));

import { followFolderOperation } from "@/src/workspace/folder-operation";
import { StorageRequestError } from "@/src/storage-mutation-submit";

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

it("shows progress while the server prepares a change, then follows its journal", async () => {
  let accept!: (value: unknown) => void;
  const prepared = new Promise((resolve) => {
    accept = resolve;
  });
  const fetch = vi.fn().mockResolvedValue(
    Response.json({
      operationId: "saved",
      status: "succeeded",
      totalCount: 2001,
      doneCount: 2001,
    }),
  );
  vi.stubGlobal("fetch", fetch);
  const result = followFolderOperation(() => prepared, "Renaming to Archive");
  expect(toast.add).toHaveBeenCalledWith(
    expect.objectContaining({
      title: "Renaming to Archive",
      description: "Getting items ready",
      type: "loading",
    }),
  );
  expect(toast.close).not.toHaveBeenCalled();
  accept({
    operationId: "saved",
    status: "queued",
    totalCount: 2001,
    doneCount: 0,
  });
  await expect(result).resolves.toMatchObject({ status: "succeeded" });
  expect(fetch).toHaveBeenCalledWith(
    "/api/files/folders/operations/saved",
    expect.anything(),
  );
  expect(toast.close).toHaveBeenCalledWith("progress");
});

it("clears progress and keeps the refusal when preparation fails", async () => {
  const refused = new StorageRequestError("Name already taken.", 409);
  await expect(
    followFolderOperation(() => Promise.reject(refused), "Renaming to Archive"),
  ).rejects.toBe(refused);
  expect(toast.close).toHaveBeenCalledWith("progress");
});
