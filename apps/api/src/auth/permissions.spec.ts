import { ALL_PERMISSIONS, PERMISSION_MAP, hasPermission } from "@hh/auth";

describe("permission map", () => {
  it("grants regular users no admin permissions", () => {
    expect(PERMISSION_MAP.user).toHaveLength(0);
    for (const permission of ALL_PERMISSIONS) {
      expect(hasPermission(["user"], permission)).toBe(false);
    }
  });

  it("nutrition_reviewer can read and review foods only", () => {
    expect(hasPermission(["nutrition_reviewer"], "foods.read")).toBe(true);
    expect(hasPermission(["nutrition_reviewer"], "foods.review")).toBe(true);
    expect(hasPermission(["nutrition_reviewer"], "foods.write")).toBe(false);
    expect(hasPermission(["nutrition_reviewer"], "foods.merge")).toBe(false);
    expect(hasPermission(["nutrition_reviewer"], "releases.publish")).toBe(false);
    expect(hasPermission(["nutrition_reviewer"], "users.manage")).toBe(false);
  });

  it("data_manager manages the catalog pipeline but not users", () => {
    for (const permission of [
      "foods.read",
      "foods.write",
      "foods.review",
      "foods.merge",
      "imports.run",
      "releases.publish",
      "jobs.view",
    ] as const) {
      expect(hasPermission(["data_manager"], permission)).toBe(true);
    }
    expect(hasPermission(["data_manager"], "users.manage")).toBe(false);
    expect(hasPermission(["data_manager"], "users.support")).toBe(false);
    expect(hasPermission(["data_manager"], "audit.read")).toBe(false);
    expect(hasPermission(["data_manager"], "system.admin")).toBe(false);
  });

  it("support_admin gets user support and audit read only", () => {
    expect(hasPermission(["support_admin"], "users.support")).toBe(true);
    expect(hasPermission(["support_admin"], "audit.read")).toBe(true);
    expect(hasPermission(["support_admin"], "users.manage")).toBe(false);
    expect(hasPermission(["support_admin"], "foods.write")).toBe(false);
  });

  it("super_admin has every permission", () => {
    for (const permission of ALL_PERMISSIONS) {
      expect(hasPermission(["super_admin"], permission)).toBe(true);
    }
  });

  it("aggregates across multiple roles", () => {
    expect(hasPermission(["user", "nutrition_reviewer"], "foods.review")).toBe(true);
    expect(hasPermission(["nutrition_reviewer", "support_admin"], "audit.read")).toBe(true);
  });

  it("ignores unknown roles safely", () => {
    expect(hasPermission(["ghost_role"], "foods.read")).toBe(false);
    expect(hasPermission([], "foods.read")).toBe(false);
  });
});
