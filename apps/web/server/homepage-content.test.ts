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
      title: "Set up this Staaash.",
      description:
        "Create the first owner account once. After that, access is private and invite-only.",
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
      title: "Sign in to this Staaash.",
      description: "This Staaash is already set up. Sign in to continue.",
    });
  });

  it("keeps signed-in members pointed at the library", () => {
    const content = getHomePageContent({
      isBootstrapped: true,
      role: "member",
    });

    expect(content.primaryAction).toMatchObject({
      href: "/library",
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
      href: "/library",
      label: "Open library",
    });
  });
});
