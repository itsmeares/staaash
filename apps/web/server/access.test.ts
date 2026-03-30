import { describe, expect, it } from "vitest";

import {
  canAccessAdminSurface,
  canAccessPrivateNamespace,
  canOwnerBrowseMemberPrivateContent,
} from "@/server/access";

describe("ownership boundaries", () => {
  it("allows only owners onto admin surfaces", () => {
    expect(canAccessAdminSurface("owner")).toBe(true);
    expect(canAccessAdminSurface("member")).toBe(false);
  });

  it("keeps owner superuser browsing disabled by default", () => {
    expect(canOwnerBrowseMemberPrivateContent()).toBe(false);
  });

  it("allows members to access only their own private namespace", () => {
    expect(
      canAccessPrivateNamespace({
        actorRole: "member",
        actorUserId: "member-1",
        namespaceOwnerUserId: "member-1",
      }),
    ).toBe(true);

    expect(
      canAccessPrivateNamespace({
        actorRole: "member",
        actorUserId: "member-1",
        namespaceOwnerUserId: "member-2",
      }),
    ).toBe(false);
  });

  it("does not grant owners implicit browse access to member private files", () => {
    expect(
      canAccessPrivateNamespace({
        actorRole: "owner",
        actorUserId: "owner-1",
        namespaceOwnerUserId: "member-2",
      }),
    ).toBe(false);
  });
});
