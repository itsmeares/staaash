import { expect, it } from "vite-plus/test";

import { syncDetail, uploadTimeLeft } from "./status";
import type { EngineStatus } from "./types";

it("shows short estimates and hides them when there is no transfer speed", () => {
  expect(uploadTimeLeft(19, 1)).toBe("~19 sec left");
  expect(uploadTimeLeft(60, 1)).toBe("~1 min left");
  expect(uploadTimeLeft(120, 1)).toBe("~2 min left");
  expect(uploadTimeLeft(5400, 1)).toBe("~1 hr 30 min left");
  expect(uploadTimeLeft(7200, 1)).toBe("~2 hr left");
  expect(uploadTimeLeft(90000, 1)).toBe("~1 day 1 hr left");
  expect(uploadTimeLeft(3600, 0)).toBe("");
  expect(uploadTimeLeft(0, 1)).toBe("");
});

it("says how much is left and how many folders are not checked yet", () => {
  const detail = (pendingBytes: number, uncheckedFolders: number) =>
    syncDetail({ pendingBytes, uncheckedFolders } as EngineStatus);
  expect(detail(4.1 * 1024 ** 3, 2)).toBe(
    "4.1 GB left · checking 2 more folders",
  );
  expect(detail(0, 1)).toBe("checking 1 more folder");
  expect(detail(2048, 0)).toBe("2 KB left");
  expect(detail(0, 0)).toBe("");
});
