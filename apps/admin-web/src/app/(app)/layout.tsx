"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { useAuth } from "@/components/auth-provider";
import { Spinner } from "@/components/ui/spinner";

/**
 * Authenticated shell for every admin route. Access/refresh tokens are
 * httpOnly cookies the client can't inspect directly, so gating happens by
 * calling GET /me on mount (via AuthProvider) and redirecting on failure —
 * acceptable for an internal tool with no SSR data requirements.
 */
export default function ProtectedLayout({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/login");
    }
  }, [loading, user, router]);

  if (loading) {
    return (
      <div className="flex h-screen w-full items-center justify-center">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return <AppShell>{children}</AppShell>;
}
