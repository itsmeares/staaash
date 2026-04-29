"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type AdminNavItem = {
  href: string;
  label: string;
};

const adminItems: AdminNavItem[] = [
  {
    href: "/admin",
    label: "Overview",
  },
  {
    href: "/admin/users",
    label: "Users",
  },
  {
    href: "/admin/invites",
    label: "Invites",
  },
  {
    href: "/admin/storage",
    label: "Storage",
  },
  {
    href: "/admin/jobs",
    label: "Jobs",
  },
  {
    href: "/admin/updates",
    label: "Updates",
  },
  {
    href: "/admin/settings",
    label: "Settings",
  },
];

const isActiveItem = (pathname: string, href: string) =>
  href === "/admin"
    ? pathname === "/admin"
    : pathname === href || pathname.startsWith(`${href}/`);

export function AdminNav() {
  const pathname = usePathname();

  return (
    <nav className="workspace-nav" aria-label="Admin">
      {adminItems.map((item) => {
        const active = isActiveItem(pathname, item.href);

        return (
          <Link
            key={item.href}
            aria-current={active ? "page" : undefined}
            className={`workspace-nav-link${active ? " workspace-nav-link-active" : ""}`}
            href={item.href}
          >
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
