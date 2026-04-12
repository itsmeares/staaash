import { describe, expect, it } from "vitest";

import { getHomePageContent } from "@/app/homepage-content";

describe("getHomePageContent", () => {
  it("routes unbootstrapped visitors to setup", () => {
    expect(
      getHomePageContent({
        isBootstrapped: false,
        role: null,
      }),
    ).toMatchObject({
      heroLabel: "First-run access",
      primaryAction: {
        href: "/setup",
        label: "Initialize instance",
      },
      secondaryAction: {
        href: "/setup",
        label: "Review the one-time setup",
      },
    });
  });

  it("routes signed-out visitors to sign-in once setup is complete", () => {
    expect(
      getHomePageContent({
        isBootstrapped: true,
        role: null,
      }),
    ).toMatchObject({
      primaryAction: {
        href: "/sign-in",
        label: "Open sign-in",
      },
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
