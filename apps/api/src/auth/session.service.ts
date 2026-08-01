import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { ERROR_CODES, type SessionView } from "@hh/contracts";
import { type Session } from "@hh/database";
import { PrismaService } from "../infra/prisma.service";
import { AuditService } from "./audit.service";
import { TokenService } from "./token.service";

export interface DeviceMeta {
  deviceName?: string | undefined;
  deviceId?: string | undefined;
  userAgent?: string | undefined;
  ip?: string | undefined;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toView(session: Session, currentSessionId: string): SessionView {
  return {
    id: session.id,
    deviceName: session.deviceName,
    deviceId: session.deviceId,
    userAgent: session.userAgent,
    ipCreated: session.ipCreated,
    createdAt: session.createdAt.toISOString(),
    lastSeenAt: session.lastSeenAt.toISOString(),
    current: session.id === currentSessionId,
  };
}

@Injectable()
export class SessionService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TokenService) private readonly tokens: TokenService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async createSession(userId: string, meta: DeviceMeta): Promise<Session> {
    return this.prisma.session.create({
      data: {
        userId,
        deviceName: meta.deviceName ?? null,
        deviceId: meta.deviceId ?? null,
        userAgent: meta.userAgent ?? null,
        ipCreated: meta.ip ?? null,
      },
    });
  }

  async listSessions(userId: string, currentSessionId: string): Promise<SessionView[]> {
    const sessions = await this.prisma.session.findMany({
      where: { userId, revokedAt: null },
      orderBy: { lastSeenAt: "desc" },
    });
    return sessions.map((s) => toView(s, currentSessionId));
  }

  /** Bump lastSeenAt (login into an existing device flow, refresh, ...). */
  async touch(sessionId: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { id: sessionId },
      data: { lastSeenAt: new Date() },
    });
  }

  /**
   * Revoke a session the caller owns. 404 (never 403) when the session does
   * not exist or belongs to someone else — no resource-existence oracle.
   */
  async revokeOwnedSession(
    userId: string,
    sessionId: string,
    actor: { actorId: string; actorRoles: readonly string[]; ip?: string | undefined },
    reason: string,
  ): Promise<void> {
    if (!UUID_RE.test(sessionId)) {
      throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND });
    }
    const session = await this.prisma.session.findFirst({
      where: { id: sessionId, userId, revokedAt: null },
    });
    if (!session) {
      throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND });
    }
    await this.revokeSession(session.id, reason, actor);
  }

  /** Revoke one session: session row + all its refresh tokens + denylist. */
  async revokeSession(
    sessionId: string,
    reason: string,
    actor?: { actorId: string; actorRoles: readonly string[]; ip?: string | undefined },
  ): Promise<void> {
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.session.updateMany({
        where: { id: sessionId, revokedAt: null },
        data: { revokedAt: now },
      }),
      this.prisma.refreshToken.updateMany({
        where: { sessionId, revokedAt: null },
        data: { revokedAt: now },
      }),
    ]);
    await this.tokens.denySession(sessionId);
    await this.audit.append({
      actorId: actor?.actorId ?? null,
      actorRoles: actor?.actorRoles ?? [],
      action: "auth.session.revoke",
      entityType: "session",
      entityId: sessionId,
      ip: actor?.ip ?? null,
      after: { reason },
    });
  }

  /** Revoke every active session of a user (password reset, suspension). */
  async revokeAllForUser(
    userId: string,
    reason: string,
    actor?: { actorId: string; actorRoles: readonly string[]; ip?: string | undefined },
  ): Promise<void> {
    const sessions = await this.prisma.session.findMany({
      where: { userId, revokedAt: null },
      select: { id: true },
    });
    for (const session of sessions) {
      await this.revokeSession(session.id, reason, actor);
    }
  }
}
