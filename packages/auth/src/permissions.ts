/** All fine-grained permissions known to the platform. */
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

/** Mirrors the Prisma UserRole enum — roles are flat, not hierarchical. */
export type Role =
  | "user"
  | "nutrition_reviewer"
  | "data_manager"
  | "support_admin"
  | "super_admin";

/**
 * role → permissions. Regular users get no admin permissions; access to their
 * own data is ownership-scoped in services, not permission-gated.
 */
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

/** True when any of the (possibly unknown) roles grants the permission. */
export function hasPermission(roles: readonly string[], permission: Permission): boolean {
  return roles.some((role) =>
    (PERMISSION_MAP[role as Role] ?? []).includes(permission),
  );
}
