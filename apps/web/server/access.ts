import type { UserRole } from "@/server/types";

export const canAccessAdminSurface = (role: UserRole) => role === "owner";

export const canOwnerBrowseMemberPrivateContent = () => false;

export const canAccessPrivateNamespace = ({
  actorRole,
  actorUserId,
  namespaceOwnerUserId,
}: {
  actorRole: UserRole;
  actorUserId: string;
  namespaceOwnerUserId: string;
}) => {
  if (actorUserId === namespaceOwnerUserId) {
    return true;
  }

  if (actorRole === "owner") {
    return canOwnerBrowseMemberPrivateContent();
  }

  return false;
};
