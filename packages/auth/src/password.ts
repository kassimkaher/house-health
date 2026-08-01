import argon2 from "argon2";

/**
 * argon2id parameters per OWASP guidance, tuned for a shared single server:
 * 64 MiB memory, 3 iterations, 1 lane. Changing these only affects NEW hashes;
 * verify() reads parameters from the stored hash string.
 */
const ARGON2_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 64 * 1024, // KiB
  timeCost: 3,
  parallelism: 1,
};

export async function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, ARGON2_OPTIONS);
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    // Malformed hash — treat as mismatch, never throw into auth flow timing.
    return false;
  }
}
