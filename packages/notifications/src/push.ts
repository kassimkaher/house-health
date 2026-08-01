export interface PushPayload {
  title: string;
  body: string;
  data?: Record<string, string> | undefined;
}

/**
 * Provider-neutral push-notification port. Phase 1 ships the log provider;
 * the FCM provider is a configured seam that activates when credentials are
 * supplied (no mobile app required for phase closure).
 */
export interface PushPort {
  readonly name: string;
  sendPush(tokens: string[], payload: PushPayload): Promise<{ delivered: number; failed: number }>;
}

export const PUSH_PORT = "PUSH_PORT";

/** Development/observability provider — prints instead of delivering. */
export class LogPushProvider implements PushPort {
  readonly name = "log";

  async sendPush(tokens: string[], payload: PushPayload): Promise<{ delivered: number; failed: number }> {
    console.warn(
      `=== DEV PUSH === to ${tokens.length} device(s): [${payload.title}] ${payload.body} ${JSON.stringify(payload.data ?? {})}`,
    );
    return { delivered: tokens.length, failed: 0 };
  }
}

export interface FcmConfig {
  /** Service-account JSON string; absent ⇒ provider is disabled. */
  serviceAccountJson?: string | undefined;
}

/**
 * FCM seam. Wire-ready: when credentials are configured, implement delivery
 * with firebase-admin here — no callers change. Until then it reports failure
 * so deliveries are marked and observable rather than silently dropped.
 */
export class FcmPushProvider implements PushPort {
  readonly name = "fcm";

  constructor(private readonly config: FcmConfig) {}

  get isConfigured(): boolean {
    return Boolean(this.config.serviceAccountJson);
  }

  async sendPush(tokens: string[], _payload: PushPayload): Promise<{ delivered: number; failed: number }> {
    if (!this.isConfigured) {
      return { delivered: 0, failed: tokens.length };
    }
    // Implementation lands with live FCM credentials + firebase-admin.
    throw new Error("FCM provider configured but delivery not yet implemented");
  }
}
