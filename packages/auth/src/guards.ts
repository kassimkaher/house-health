import {
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ERROR_CODES } from "@hh/contracts";
import { IS_PUBLIC_KEY, PERMISSION_KEY, type RequestUser } from "./decorators";
import { verifyAccessToken, type AccessTokenClaims } from "./jwt";
import { hasPermission, type Permission } from "./permissions";
import { sessionDenyKey } from "./refresh-token";

/** Injection token for guard options (host app provides from its config). */
export const AUTH_GUARD_OPTIONS = "AUTH_GUARD_OPTIONS";

export interface AuthGuardOptions {
  jwtPublicKeyPem: string;
}

/**
 * Minimal structural Redis interface — satisfied by ioredis. Keeps @hh/auth
 * free of a hard ioredis dependency.
 */
export interface RedisLike {
  exists(key: string): Promise<number>;
}

/** Injection token the host app binds its Redis client to. */
export const REDIS = "REDIS";

interface GuardedRequest {
  headers: Record<string, string | string[] | undefined>;
  user?: RequestUser;
}

/**
 * Global bearer-JWT guard: skips @Public() routes, verifies the ES256 access
 * token, rejects denylisted sessions (`sess:deny:{sid}`), and attaches the
 * claims to `request.user`.
 *
 * User status is NOT checked per request — roles/status ride in the token and
 * revocation flows denylist the session ids. TODO(admin phase): the suspension
 * endpoint must denylist all of the suspended user's active session ids.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(AUTH_GUARD_OPTIONS) private readonly options: AuthGuardOptions,
    @Inject(REDIS) private readonly redis: RedisLike,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic === true) {
      return true;
    }

    const request = context.switchToHttp().getRequest<GuardedRequest>();
    const header = request.headers["authorization"];
    if (typeof header !== "string" || !header.startsWith("Bearer ")) {
      throw new UnauthorizedException({ code: ERROR_CODES.AUTH_UNAUTHORIZED });
    }

    let claims: AccessTokenClaims;
    try {
      claims = await verifyAccessToken(header.slice("Bearer ".length), this.options.jwtPublicKeyPem);
    } catch {
      throw new UnauthorizedException({ code: ERROR_CODES.AUTH_TOKEN_EXPIRED });
    }

    if ((await this.redis.exists(sessionDenyKey(claims.sid))) > 0) {
      throw new UnauthorizedException({ code: ERROR_CODES.AUTH_SESSION_REVOKED });
    }

    request.user = { userId: claims.sub, sessionId: claims.sid, roles: claims.roles };
    return true;
  }
}

/**
 * Enforces @RequirePermission(...) metadata against the caller's roles.
 * Routes without the metadata pass through untouched.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const permission = this.reflector.getAllAndOverride<Permission | undefined>(PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (permission === undefined) {
      return true;
    }
    const request = context.switchToHttp().getRequest<GuardedRequest>();
    const user = request.user;
    if (!user) {
      throw new UnauthorizedException({ code: ERROR_CODES.AUTH_UNAUTHORIZED });
    }
    if (!hasPermission(user.roles, permission)) {
      throw new ForbiddenException({ code: ERROR_CODES.AUTH_FORBIDDEN });
    }
    return true;
  }
}
