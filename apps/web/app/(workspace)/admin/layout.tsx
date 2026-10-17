import { requireAdminPageSession } from "@/server/auth/guards";

export const dynamic = "force-dynamic";

// Admin pages render inside the workspace shell; this only keeps them owner-only.
export default async function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  await requireAdminPageSession();
  return children;
}
