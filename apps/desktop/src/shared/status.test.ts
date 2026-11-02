import { expect, it } from "vite-plus/test";

import { uploadTimeLeft } from "./status";

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
