import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const workflowUrl = new URL(
  "../../../.github/workflows/release.yml",
  import.meta.url,
);

const readWorkflow = () => readFile(workflowUrl, "utf8");

describe("release workflow recovery topology", () => {
  it("pins manual recovery tooling to exact main workflow commit", async () => {
    const workflow = await readWorkflow();

    expect(workflow).toContain(
      "if: github.event_name == 'workflow_dispatch' && github.ref != 'refs/heads/main'",
    );
    expect(workflow).toContain(
      "EXPECTED_TOOLING_SHA: ${{ github.event_name == 'workflow_dispatch' && github.sha || '' }}",
    );
    expect(workflow).toContain(
      "ref: ${{ github.event_name == 'workflow_dispatch' && github.sha || env.RELEASE_TAG }}",
    );
    expect(workflow).toContain(
      "ref: ${{ needs.preflight.outputs.tooling_sha }}",
    );
    expect(workflow).toContain("TOOLING_SHA: ${{ steps.tooling.outputs.sha }}");
    expect(workflow).toContain(
      "tooling_ci_run_id: ${{ steps.preflight.outputs.tooling_ci_run_id }}",
    );
  });

  it("keeps release source separate and tied to requested tag", async () => {
    const workflow = await readWorkflow();

    expect(workflow.match(/path: release-source/gu)).toHaveLength(2);
    expect(workflow.match(/ref: \$\{\{ env\.RELEASE_TAG \}\}/gu)).toHaveLength(
      2,
    );
    expect(workflow).toContain(
      "RELEASE_SOURCE_ROOT: ${{ github.workspace }}/release-source",
    );
    expect(workflow).toContain("context: ${{ env.RELEASE_SOURCE_ROOT }}");
    expect(workflow).not.toContain("context: .\n");
  });

  it("runs only verified tooling orchestrator with explicit roots", async () => {
    const workflow = await readWorkflow();

    expect(workflow.match(/path: tooling/gu)).toHaveLength(2);
    expect(workflow).toContain("TOOLING_ROOT: ${{ github.workspace }}/tooling");
    expect(workflow).toContain(
      "ASSET_DIR: ${{ github.workspace }}/release-assets",
    );
    expect(workflow).toContain(
      "run: node tooling/scripts/release/index.mjs preflight",
    );
    expect(workflow).toContain(
      "run: node tooling/scripts/release/index.mjs reconcile-release",
    );
    expect(workflow).not.toMatch(/run: node scripts\/release\/index\.mjs/u);
    expect(workflow).toContain(
      "tooling_sha: ${{ steps.preflight.outputs.tooling_sha }}",
    );
    expect(workflow).toContain(
      "release_ci_run_id: ${{ steps.preflight.outputs.release_ci_run_id }}",
    );
  });
});
