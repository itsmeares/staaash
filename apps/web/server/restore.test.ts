import { describe, expect, it } from "vitest";

import {
  createRestoreReconciliationReport,
  hasRestoreIssues,
} from "@/server/restore";

describe("restore reconciliation", () => {
  it("creates empty reconciliation reports by default", () => {
    expect(createRestoreReconciliationReport()).toEqual({
      missingOriginalIds: [],
      orphanedStorageKeys: [],
    });
  });

  it("flags restore reports with missing originals or orphaned storage", () => {
    expect(
      hasRestoreIssues(
        createRestoreReconciliationReport({
          missingOriginalIds: ["file-1"],
        }),
      ),
    ).toBe(true);
  });
});
