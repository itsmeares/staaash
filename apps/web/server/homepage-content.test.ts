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
      primaryAction: {
        href: "/setup",
        label: "Initialize this instance",
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

  it("routes members to the library without admin access", () => {
    const content = getHomePageContent({
      isBootstrapped: true,
      role: "member",
    });

    expect(content.primaryAction).toMatchObject({
      href: "/library",
      label: "Open library",
    });
    expect(content.secondaryLinks).toEqual([
      {
        href: "/settings",
        label: "Settings",
      },
    ]);
  });

  it("adds the admin link for owners", () => {
    const content = getHomePageContent({
      isBootstrapped: true,
      role: "owner",
    });

    expect(content.secondaryLinks).toEqual([
      {
        href: "/settings",
        label: "Settings",
      },
      {
        href: "/admin",
        label: "Admin",
      },
    ]);
  });
});
