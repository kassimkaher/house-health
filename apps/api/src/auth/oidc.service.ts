import {
  ConflictException,
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { REDIS } from "@hh/auth";
import { APP_CONFIG, type AppConfig, type GoogleOidcConfig } from "@hh/config";
import { ERROR_CODES, type AuthTokensView, type UserView } from "@hh/contracts";
import { type User } from "@hh/database";
import type Redis from "ioredis";
import { PrismaService } from "../infra/prisma.service";
import { toUserView } from "./auth.service";
import { SessionService, type DeviceMeta } from "./session.service";
import { TokenService } from "./token.service";

const GOOGLE_ISSUER = "https://accounts.google.com";
const STATE_TTL_SEC = 600; // 10 min

// openid-client v6 is ESM-only; this app compiles to CJS. `new Function`
// keeps tsc from transpiling import() into require(). The module is loaded
// lazily so environments without OIDC (and jest) never touch it.
const importOidc = new Function(
  "return import('openid-client')",
) as unknown as () => Promise<OidcModule>;

interface OidcIdClaims {
  sub?: unknown;
  email?: unknown;
  email_verified?: unknown;
  name?: unknown;
}

interface OidcTokenResponse {
  claims(): OidcIdClaims | undefined;
}

/** Structural view of the openid-client v6 surface we use. */
interface OidcModule {
  discovery(server: URL, clientId: string, clientSecret?: string): Promise<object>;
  randomPKCECodeVerifier(): string;
  calculatePKCECodeChallenge(codeVerifier: string): Promise<string>;
  randomState(): string;
  buildAuthorizationUrl(config: object, parameters: Record<string, string>): URL;
  authorizationCodeGrant(
    config: object,
    currentUrl: URL,
    checks?: { pkceCodeVerifier?: string; expectedState?: string },
  ): Promise<OidcTokenResponse>;
}

@Injectable()
export class OidcService {
  private oidcModulePromise: Promise<OidcModule> | null = null;
  private googleConfigPromise: Promise<object> | null = null;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(TokenService) private readonly tokens: TokenService,
  ) {}

  private google(): GoogleOidcConfig {
    if (!this.config.google) {
      throw new ServiceUnavailableException({ code: ERROR_CODES.AUTH_OIDC_NOT_CONFIGURED });
    }
    return this.config.google;
  }

  private oidc(): Promise<OidcModule> {
    this.oidcModulePromise ??= importOidc();
    return this.oidcModulePromise;
  }

  private async googleConfiguration(): Promise<object> {
    const google = this.google();
    if (!this.googleConfigPromise) {
      this.googleConfigPromise = this.oidc().then((oc) =>
        oc.discovery(new URL(GOOGLE_ISSUER), google.clientId, google.clientSecret),
      );
      // A transient discovery failure must not poison the cache forever.
      this.googleConfigPromise.catch(() => {
        this.googleConfigPromise = null;
      });
    }
    return this.googleConfigPromise;
  }

  /** Build the Google authorization URL; PKCE verifier+state parked in Redis. */
  async start(): Promise<{ url: string }> {
    const google = this.google();
    const oc = await this.oidc();
    const configuration = await this.googleConfiguration();

    const codeVerifier = oc.randomPKCECodeVerifier();
    const codeChallenge = await oc.calculatePKCECodeChallenge(codeVerifier);
    const state = oc.randomState();

    await this.redis.set(
      `oidc:state:${state}`,
      JSON.stringify({ codeVerifier }),
      "EX",
      STATE_TTL_SEC,
    );

    const url = oc.buildAuthorizationUrl(configuration, {
      redirect_uri: google.redirectUri,
      scope: "openid email profile",
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      state,
    });
    return { url: url.toString() };
  }

  /**
   * Exchange the authorization code, then resolve the local account:
   * AuthIdentity(google, sub) first; otherwise link by email — but only when
   * Google reports the email as verified; otherwise create a fresh account.
   */
  async callback(
    code: string,
    state: string,
    meta: DeviceMeta,
  ): Promise<AuthTokensView & { user: UserView }> {
    const google = this.google();

    const stored = await this.redis.getdel(`oidc:state:${state}`);
    if (!stored) {
      throw new UnauthorizedException({ code: ERROR_CODES.AUTH_OIDC_EXCHANGE_FAILED });
    }
    const { codeVerifier } = JSON.parse(stored) as { codeVerifier: string };

    const oc = await this.oidc();
    const configuration = await this.googleConfiguration();
    const currentUrl = new URL(google.redirectUri);
    currentUrl.searchParams.set("code", code);
    currentUrl.searchParams.set("state", state);

    let claims: OidcIdClaims | undefined;
    try {
      const response = await oc.authorizationCodeGrant(configuration, currentUrl, {
        pkceCodeVerifier: codeVerifier,
        expectedState: state,
      });
      claims = response.claims();
    } catch {
      throw new UnauthorizedException({ code: ERROR_CODES.AUTH_OIDC_EXCHANGE_FAILED });
    }

    const sub = typeof claims?.sub === "string" ? claims.sub : null;
    const email = typeof claims?.email === "string" ? claims.email : null;
    const emailVerified = claims?.email_verified === true;
    if (!sub) {
      throw new UnauthorizedException({ code: ERROR_CODES.AUTH_OIDC_EXCHANGE_FAILED });
    }

    const user = await this.resolveUser(sub, email, emailVerified);

    const session = await this.sessions.createSession(user.id, {
      ...meta,
      deviceName: meta.deviceName ?? "Google sign-in",
    });
    const tokens = await this.tokens.issueForNewSession(
      { id: user.id, roles: user.roles as string[] },
      session.id,
    );
    const profile = await this.prisma.userProfile.findUnique({
      where: { userId: user.id },
      select: { displayName: true },
    });
    return { ...tokens, user: toUserView(user, profile?.displayName ?? null) };
  }

  private async resolveUser(
    sub: string,
    email: string | null,
    emailVerified: boolean,
  ): Promise<User> {
    const identity = await this.prisma.authIdentity.findUnique({
      where: { provider_providerSubject: { provider: "google", providerSubject: sub } },
      include: { user: true },
    });
    if (identity) {
      const user = identity.user;
      if (user.deletedAt !== null || (user.status !== "active" && user.status !== "pending_verification")) {
        throw new UnauthorizedException({ code: ERROR_CODES.AUTH_INVALID_CREDENTIALS });
      }
      return user;
    }

    if (!email) {
      throw new UnauthorizedException({ code: ERROR_CODES.AUTH_OIDC_EXCHANGE_FAILED });
    }

    const existing = await this.prisma.user.findFirst({
      where: { email, deletedAt: null },
    });

    if (existing) {
      // NEVER auto-link when Google has not verified ownership of the email.
      if (!emailVerified) {
        throw new ConflictException({ code: ERROR_CODES.AUTH_OIDC_EMAIL_CONFLICT });
      }
      if (existing.status === "suspended" || existing.status === "deleted") {
        throw new UnauthorizedException({ code: ERROR_CODES.AUTH_INVALID_CREDENTIALS });
      }
      return this.prisma.$transaction(async (tx) => {
        await tx.authIdentity.create({
          data: {
            userId: existing.id,
            provider: "google",
            providerSubject: sub,
            emailAtLink: email,
          },
        });
        // Google verified the address — a pending account becomes active.
        return tx.user.update({
          where: { id: existing.id },
          data: {
            emailVerifiedAt: existing.emailVerifiedAt ?? new Date(),
            status: existing.status === "pending_verification" ? "active" : existing.status,
          },
        });
      });
    }

    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email,
          passwordHash: null,
          status: "active",
          emailVerifiedAt: emailVerified ? new Date() : null,
        },
      });
      await tx.userProfile.create({ data: { userId: user.id } });
      await tx.authIdentity.create({
        data: { userId: user.id, provider: "google", providerSubject: sub, emailAtLink: email },
      });
      return user;
    });
  }
}
