"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useMemo } from "react";
import type { ReactNode } from "react";
import type { UserView } from "@hh/contracts";
import { apiFetch, ApiError } from "@/lib/api";
import { hasPermission, hasAnyPermission } from "@/lib/permissions";
import type { Permission } from "@/lib/permissions";

interface AuthContextValue {
  user: UserView | null;
  loading: boolean;
  error: ApiError | null;
  can: (permission: Permission) => boolean;
  canAny: (permissions: readonly Permission[]) => boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const ME_QUERY_KEY = ["me"] as const;

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();

  const { data, isLoading, error, refetch } = useQuery<UserView, ApiError>({
    queryKey: ME_QUERY_KEY,
    queryFn: () => apiFetch<UserView>("/me"),
    retry: false,
    staleTime: 60_000,
  });

  const refresh = useCallback(async () => {
    await refetch();
  }, [refetch]);

  const logout = useCallback(async () => {
    try {
      await apiFetch("/auth/logout", { method: "POST", parseAs: "none" });
    } finally {
      queryClient.setQueryData(ME_QUERY_KEY, null);
      await queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
    }
  }, [queryClient]);

  const user = data ?? null;
  const roles = useMemo(() => user?.roles ?? [], [user]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading: isLoading,
      error: error instanceof ApiError ? error : null,
      can: (permission: Permission) => hasPermission(roles, permission),
      canAny: (permissions: readonly Permission[]) => hasAnyPermission(roles, permissions),
      refresh,
      logout,
    }),
    [user, isLoading, error, roles, refresh, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
