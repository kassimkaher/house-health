import { SignJWT, jwtVerify, importPKCS8, importSPKI, type KeyLike } from "jose";

const ALG = "ES256";

/** Claims carried by every access token. */
export interface AccessTokenClaims {
  /** User id. */
  sub: string;
  /** Session id — denylisted in Redis on revocation. */
  sid: string;
  roles: string[];
}

// PEM → KeyLike imports are async and non-trivial; cache per PEM string.
const privateKeyCache = new Map<string, Promise<KeyLike>>();
const publicKeyCache = new Map<string, Promise<KeyLike>>();

function getPrivateKey(pem: string): Promise<KeyLike> {
  let key = privateKeyCache.get(pem);
  if (!key) {
    key = importPKCS8(pem, ALG);
    privateKeyCache.set(pem, key);
  }
  return key;
}

function getPublicKey(pem: string): Promise<KeyLike> {
  let key = publicKeyCache.get(pem);
  if (!key) {
    key = importSPKI(pem, ALG);
    publicKeyCache.set(pem, key);
  }
  return key;
}

export interface SignAccessTokenOptions {
  privateKeyPem: string;
  ttlSec: number;
  userId: string;
  sessionId: string;
  roles: string[];
}

export async function signAccessToken(opts: SignAccessTokenOptions): Promise<string> {
  const key = await getPrivateKey(opts.privateKeyPem);
  return new SignJWT({ sid: opts.sessionId, roles: opts.roles })
    .setProtectedHeader({ alg: ALG })
    .setSubject(opts.userId)
    .setIssuedAt()
    .setExpirationTime(`${opts.ttlSec}s`)
    .sign(key);
}

/**
 * Verify signature + expiry and validate the claim shape. Throws on any
 * failure — callers translate to a 401.
 */
export async function verifyAccessToken(
  token: string,
  publicKeyPem: string,
): Promise<AccessTokenClaims> {
  const key = await getPublicKey(publicKeyPem);
  const { payload } = await jwtVerify(token, key, { algorithms: [ALG] });
  const { sub, sid, roles } = payload as Record<string, unknown>;
  if (
    typeof sub !== "string" ||
    typeof sid !== "string" ||
    !Array.isArray(roles) ||
    !roles.every((r): r is string => typeof r === "string")
  ) {
    throw new Error("access token has malformed claims");
  }
  return { sub, sid, roles };
}
