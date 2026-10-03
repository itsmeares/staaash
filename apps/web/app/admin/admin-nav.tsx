"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

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
    href: "/admin/storage",
    label: "Storage",
  },
  {
    href: "/admin/jobs",
    label: "Jobs",
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
    <nav
      className="flex flex-none [scrollbar-width:none] flex-row gap-1.5 overflow-x-auto pb-1 md:flex-1 md:flex-col md:gap-0.5 md:overflow-visible md:pb-0 [&::-webkit-scrollbar]:hidden"
      aria-label="Admin"
    >
      {adminItems.map((item) => {
        const active = isActiveItem(pathname, item.href);

        return (
          <Link
            key={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex min-h-11 flex-none items-center gap-2 rounded-lg px-3 text-sm font-medium text-foreground/62 transition-colors hover:bg-hover hover:text-foreground md:h-control md:px-3.5 md:text-base",
              active &&
                "bg-selected font-semibold text-primary-ink hover:bg-primary/12 hover:text-primary-ink",
            )}
            href={item.href}
          >
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
