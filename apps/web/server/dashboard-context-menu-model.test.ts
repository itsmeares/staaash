import { describe, expect, it } from "vitest";

import { getVisibleDashboardMenuGroups } from "@/app/dashboard-context-menu-model";

describe("dashboard context menu model", () => {
  it("removes hidden actions and empty groups", () => {
    expect(
      getVisibleDashboardMenuGroups([
        { actions: [{ hidden: true }, {}] },
        { actions: [{ hidden: true }] },
        { actions: [{}] },
      ]),
    ).toEqual([{ actions: [{}] }, { actions: [{}] }]);
  });

  it("keeps disabled actions visible", () => {
    expect(
      getVisibleDashboardMenuGroups([{ actions: [{ disabled: true }] }]),
    ).toEqual([{ actions: [{ disabled: true }] }]);
  });
});
