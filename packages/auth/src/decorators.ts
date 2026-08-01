import {
  SetMetadata,
  createParamDecorator,
  type CustomDecorator,
  type ExecutionContext,
} from "@nestjs/common";
import { type Permission } from "./permissions";

export const IS_PUBLIC_KEY = "hh:isPublic";
export const PERMISSION_KEY = "hh:permission";

/** Marks a route (or controller) as reachable without a bearer token. */
export function Public(): CustomDecorator<string> {
  return SetMetadata(IS_PUBLIC_KEY, true);
}

/** Requires the caller's roles to grant the given permission (PermissionsGuard). */
export function RequirePermission(permission: Permission): CustomDecorator<string> {
  return SetMetadata(PERMISSION_KEY, permission);
}

/** Shape attached to `request.user` by JwtAuthGuard. */
export interface RequestUser {
  userId: string;
  sessionId: string;
  roles: string[];
}

/** Injects the authenticated RequestUser into a handler parameter. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): RequestUser | undefined => {
    const request = ctx.switchToHttp().getRequest<{ user?: RequestUser }>();
    return request.user;
  },
);
