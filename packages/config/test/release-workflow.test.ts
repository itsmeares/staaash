import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const workflowUrl = new URL(
  "../../../.github/workflows/release.yml",
  import.meta.url,
);
const orchestratorUrl = new URL(
  "../../../scripts/release/index.mjs",
  import.meta.url,
);

const readWorkflow = () => readFile(workflowUrl, "utf8");
const readOrchestrator = () => readFile(orchestratorUrl, "utf8");

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

  it("propagates the resolved draft release ID to every later step", async () => {
    const workflow = await readWorkflow();
    const ensureDraft = workflow.indexOf(
      "- name: Create or verify draft release",
    );
    const captureReleaseId = workflow.indexOf(
      "- name: Capture exact release ID",
    );
    const inspectImage = workflow.indexOf(
      "- name: Inspect existing versioned image",
    );

    expect(workflow).toContain(
      "- name: Create or verify draft release\n        id: release",
    );
    expect(workflow).toContain(
      "RESOLVED_RELEASE_ID: ${{ steps.release.outputs.release_id }}",
    );
    expect(workflow).toContain(
      'if [[ ! "$RESOLVED_RELEASE_ID" =~ ^[1-9][0-9]*$ ]]; then',
    );
    expect(workflow).toContain(
      'echo "RELEASE_ID=$RESOLVED_RELEASE_ID" >> "$GITHUB_ENV"',
    );
    expect(ensureDraft).toBeGreaterThan(-1);
    expect(captureReleaseId).toBeGreaterThan(ensureDraft);
    expect(inspectImage).toBeGreaterThan(captureReleaseId);
  });

  it("requires an explicit exact ID for manual recovery", async () => {
    const workflow = await readWorkflow();

    expect(workflow).toContain(
      "release_id:\n        description: Exact existing draft release ID to resume\n        required: true",
    );
    expect(workflow).toContain(
      "RECOVERY_RELEASE_ID: ${{ github.event_name == 'workflow_dispatch' && inputs.release_id || '' }}",
    );
    expect(workflow).toContain(
      'if [[ ! "$RECOVERY_RELEASE_ID" =~ ^[1-9][0-9]*$ ]]; then',
    );
    expect(workflow).toContain("RELEASE_EVENT_NAME: ${{ github.event_name }}");
  });

  it("never discovers a draft by release collection or tag", async () => {
    const orchestrator = await readOrchestrator();
    const postResolution = orchestrator.slice(
      orchestrator.indexOf("const commandInspectImage"),
    );

    expect(orchestrator).not.toContain("findReleaseByTag");
    expect(orchestrator).not.toContain("getReleases");
    expect(orchestrator).not.toMatch(/releases\?per_page/u);
    expect(orchestrator).toContain(
      "const resolved = fetchRelease(context.repository, releaseId);",
    );
    expect(postResolution).not.toContain("findReleaseByTag(");
    expect(postResolution).not.toContain("getReleases(");
    expect(postResolution).toContain(
      "const refreshed = await refreshRelease(context.repository, release.id);",
    );
    expect(postResolution).toContain(
      "const { release, provenance } = resolveDraftReleaseById({",
    );
    expect(postResolution).toContain(
      "const release = requirePublishedRelease(context, releaseId);",
    );
    expect(orchestrator.match(/releases\/latest/gu)).toHaveLength(1);
  });
});
