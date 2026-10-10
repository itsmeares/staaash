import { Badge, type BadgeProps } from "@/components/ui/badge";

import { capitalize, getAdminStatusVariant } from "./admin-format";

export function AdminStatusBadge({
  status,
  size,
  children,
}: {
  status: string;
  size?: BadgeProps["size"];
  children?: React.ReactNode;
}) {
  return (
    <Badge size={size} variant={getAdminStatusVariant(status)}>
      {children ?? capitalize(status)}
    </Badge>
  );
}
