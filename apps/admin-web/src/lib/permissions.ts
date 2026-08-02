/**
 * Client-side mirror of packages/auth/src/permissions.ts, used only to filter
 * the sidebar nav and hide controls the user can't use. This is UX, not
 * security — every mutating request is still enforced server-side by the
 * same permission map via @RequirePermission guards.
 */

export type Permission =
  | "foods.read"
  | "foods.write"
  | "foods.review"
  | "foods.merge"
  | "releases.publish"
  | "imports.run"
  | "users.manage"
  | "users.support"
  | "jobs.view"
  | "audit.read"
  | "policies.manage"
  | "system.admin";

export const ALL_PERMISSIONS: readonly Permission[] = [
  "foods.read",
  "foods.write",
  "foods.review",
  "foods.merge",
  "releases.publish",
  "imports.run",
  "users.manage",
  "users.support",
  "jobs.view",
  "audit.read",
  "policies.manage",
  "system.admin",
];

export type Role = "user" | "nutrition_reviewer" | "data_manager" | "support_admin" | "super_admin";

export const ALL_ROLES: readonly Role[] = [
  "user",
  "nutrition_reviewer",
  "data_manager",
  "support_admin",
  "super_admin",
];

export const PERMISSION_MAP: Readonly<Record<Role, readonly Permission[]>> = {
  user: [],
  nutrition_reviewer: ["foods.read", "foods.review"],
  data_manager: [
    "foods.read",
    "foods.write",
    "foods.review",
    "foods.merge",
    "imports.run",
    "releases.publish",
    "jobs.view",
  ],
  support_admin: ["users.support", "audit.read"],
  super_admin: ALL_PERMISSIONS,
};

export function hasPermission(roles: readonly string[], permission: Permission): boolean {
  return roles.some((role) => (PERMISSION_MAP[role as Role] ?? []).includes(permission));
}

export function hasAnyPermission(roles: readonly string[], permissions: readonly Permission[]): boolean {
  return permissions.some((permission) => hasPermission(roles, permission));
}
