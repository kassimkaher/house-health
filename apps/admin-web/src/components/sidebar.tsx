"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/components/auth-provider";
import { cn } from "@/lib/cn";
import type { Permission } from "@/lib/permissions";

interface NavItem {
  href: string;
  label: string;
  /** Any one of these permissions grants visibility; omit for always-visible. */
  permissions?: Permission[];
}

const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Dashboard" },
  { href: "/users", label: "Users", permissions: ["users.support", "users.manage"] },
  { href: "/catalog/foods", label: "Foods", permissions: ["foods.read"] },
  { href: "/catalog/categories", label: "Categories", permissions: ["foods.read"] },
  { href: "/catalog/brands", label: "Brands", permissions: ["foods.read"] },
  { href: "/catalog/nutrients", label: "Nutrient definitions", permissions: ["foods.read"] },
  { href: "/review/duplicates", label: "Duplicate review", permissions: ["foods.merge"] },
  { href: "/imports", label: "Imports", permissions: ["imports.run"] },
  { href: "/releases", label: "Releases", permissions: ["releases.publish"] },
  { href: "/calc-policies", label: "Calc policies", permissions: ["policies.manage"] },
  { href: "/jobs", label: "Jobs", permissions: ["jobs.view"] },
  { href: "/audit", label: "Audit log", permissions: ["audit.read"] },
  { href: "/system", label: "System", permissions: ["system.admin"] },
];

export function Sidebar() {
  const pathname = usePathname();
  const { canAny } = useAuth();

  const items = NAV_ITEMS.filter((item) => !item.permissions || canAny(item.permissions));

  return (
    <nav className="flex h-full w-56 shrink-0 flex-col gap-1 border-r border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-950">
      <div className="mb-3 px-2 text-sm font-semibold text-slate-900 dark:text-slate-100">Health House Admin</div>
      {items.map((item) => {
        const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors",
              active
                ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
