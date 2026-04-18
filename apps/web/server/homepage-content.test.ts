import { describe, expect, it } from "vitest";

import { getHomePageContent } from "@/app/homepage-content";

describe("getHomePageContent", () => {
  it("routes unbootstrapped visitors to setup", () => {
    expect(
      getHomePageContent({
        isBootstrapped: false,
        role: null,
      }),
    ).toEqual({
      primaryAction: {
        href: "/setup",
        label: "Set up Staaash",
      },
      title: "Bring this Staaash instance online.",
      description:
        "Create the first owner account once. After that, this Staaash stays private and invite-only.",
    });
  });

  it("routes signed-out visitors to sign-in once setup is complete", () => {
    expect(
      getHomePageContent({
        isBootstrapped: true,
        role: null,
      }),
    ).toEqual({
      primaryAction: {
        href: "/sign-in",
        label: "Sign in",
      },
      title: "Private storage, right where you left it.",
      description: "Sign in to open your files, folders, and shared items.",
    });
  });

  it("keeps signed-in members pointed at the library", () => {
    const content = getHomePageContent({
      isBootstrapped: true,
      role: "member",
    });

    expect(content.primaryAction).toMatchObject({
      href: "/files",
      label: "Open library",
    });
    expect(content.secondaryAction).toBeUndefined();
  });

  it("uses the library fallback for owners too", () => {
    const content = getHomePageContent({
      isBootstrapped: true,
      role: "owner",
    });

    expect(content.primaryAction).toMatchObject({
      href: "/files",
      label: "Open library",
    });
  });
});
