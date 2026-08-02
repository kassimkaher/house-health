import { z } from "zod";

export const accountStatusSchema = z.enum(["pending_verification", "active", "suspended", "deleted"]);
export const userRoleSchema = z.enum(["user", "nutrition_reviewer", "data_manager", "support_admin", "super_admin"]);

export const listUsersQuerySchema = z
  .object({
    q: z.string().trim().min(1).max(200).optional(),
    status: accountStatusSchema.optional(),
    role: userRoleSchema.optional(),
    cursor: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();
export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;

export const setUserRolesSchema = z
  .object({ roles: z.array(userRoleSchema).min(1).max(5) })
  .strict();
export type SetUserRolesDto = z.infer<typeof setUserRolesSchema>;

export const suspendUserSchema = z
  .object({ reason: z.string().trim().min(1).max(500) })
  .strict();
export type SuspendUserDto = z.infer<typeof suspendUserSchema>;

// --- Duplicate review / merge ----------------------------------------------

export const mergeFoodsSchema = z
  .object({
    sourceFoodId: z.string().uuid(),
    targetFoodId: z.string().uuid(),
    notes: z.string().trim().max(2000).optional(),
  })
  .strict()
  .refine((v) => v.sourceFoodId !== v.targetFoodId, {
    message: "source and target must differ",
    path: ["sourceFoodId"],
  });
export type MergeFoodsDto = z.infer<typeof mergeFoodsSchema>;

export const findDuplicatesQuerySchema = z
  .object({
    threshold: z.coerce.number().min(0.3).max(1).default(0.6),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict();
export type FindDuplicatesQuery = z.infer<typeof findDuplicatesQuerySchema>;

// --- Calculation policies ---------------------------------------------------

export const createCalcPolicySchema = z
  .object({
    key: z.string().regex(/^[a-z0-9_]+$/).min(2).max(60),
    config: z.record(z.string(), z.unknown()),
    notes: z.string().trim().max(2000).optional(),
    activate: z.boolean().default(false),
  })
  .strict();
export type CreateCalcPolicyDto = z.infer<typeof createCalcPolicySchema>;

// --- Audit log ---------------------------------------------------------------

export const listAuditLogQuerySchema = z
  .object({
    entityType: z.string().trim().max(60).optional(),
    entityId: z.string().trim().max(120).optional(),
    actorId: z.string().uuid().optional(),
    action: z.string().trim().max(120).optional(),
    /** Opaque numeric-string cursor (audit_log.id); strictly decreasing. */
    cursor: z.string().regex(/^\d+$/).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict();
export type ListAuditLogQuery = z.infer<typeof listAuditLogQuerySchema>;
