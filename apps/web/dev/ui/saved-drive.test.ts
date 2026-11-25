import { describe, expect, it } from "vite-plus/test";
import { restoreDrive } from "./saved-drive";
import { createState } from "./state";

const day = 24 * 60 * 60 * 1000;
const now = Date.UTC(2026, 10, 25);

function savedDrive(version: string, daysAgo: number) {
  const state = createState("demo");
  state.userId = state.users[0]!.id;
  state.instanceName = "Changed by the visitor";
  return { version, seenAt: now - daysAgo * day, state };
}
const seed = () => createState("demo");

describe("restoreDrive", () => {
  it("keeps the drive for the same build", () => {
    const saved = savedDrive("2.0.0", 1);
    const { state, kept } = restoreDrive(saved, "2.0.0", seed, now);
    expect(kept).toBe(true);
    expect(state).toBe(saved.state);
  });

  it("resets the drive for a new build but keeps the visitor signed in", () => {
    const saved = savedDrive("2.0.0", 1);
    const { state, kept } = restoreDrive(saved, "2.1.0", seed, now);
    expect(kept).toBe(false);
    expect(state.instanceName).toBe("Staaash");
    expect(state.userId).toBe(saved.state.userId);
  });

  it("signs the visitor out after a week away", () => {
    const { state, kept } = restoreDrive(
      savedDrive("2.0.0", 8),
      "2.1.0",
      seed,
      now,
    );
    expect(kept).toBe(false);
    expect(state.userId).toBeNull();
  });

  it("does not sign in as someone the new build no longer has", () => {
    const saved = savedDrive("2.0.0", 1);
    saved.state.userId = "removed-person";
    expect(restoreDrive(saved, "2.1.0", seed, now).state.userId).toBeNull();
  });

  it("starts signed out on a first visit", () => {
    expect(restoreDrive(undefined, "2.1.0", seed, now).state.userId).toBeNull();
  });
});
