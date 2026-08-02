"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ReactNode } from "react";
import { useAuth } from "@/components/auth-provider";
import { Sidebar } from "@/components/sidebar";
import { Button } from "@/components/ui/button";

export function AppShell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await logout();
    } finally {
      setLoggingOut(false);
      router.push("/login");
    }
  }

  return (
    <div className="flex h-screen w-full overflow-hidden">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-white px-6 py-3 dark:border-slate-800 dark:bg-slate-950">
          <div className="text-sm text-slate-500 dark:text-slate-400">Admin dashboard</div>
          <div className="flex items-center gap-3">
            {user && (
              <div className="text-right text-xs text-slate-500 dark:text-slate-400">
                <div className="text-sm font-medium text-slate-900 dark:text-slate-100">{user.email}</div>
                <div>{user.roles.join(", ") || "no roles"}</div>
              </div>
            )}
            <Button variant="secondary" size="sm" onClick={() => void handleLogout()} disabled={loggingOut}>
              {loggingOut ? "Signing out…" : "Sign out"}
            </Button>
          </div>
        </header>
        <main className="min-w-0 flex-1 overflow-y-auto bg-slate-50 p-6 dark:bg-slate-900/40">{children}</main>
      </div>
    </div>
  );
}
