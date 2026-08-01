import { PrismaClient, type Prisma } from "@prisma/client";

/**
 * Single PrismaClient instance per process. Nest apps wrap this in a
 * PrismaService provider; scripts/seeds import it directly.
 */
export const prisma = new PrismaClient({
  log:
    process.env.PRISMA_LOG === "query"
      ? ["query", "warn", "error"]
      : ["warn", "error"],
});

/** Either the root client or a transaction client — repositories accept both. */
export type PrismaClientLike = PrismaClient | Prisma.TransactionClient;

/**
 * Serializable-enough transaction helper with sane defaults. Business services
 * pass a callback receiving the transaction client; repositories must accept
 * PrismaClientLike so they compose inside transactions.
 */
export async function withTx<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  opts?: { timeoutMs?: number },
): Promise<T> {
  return prisma.$transaction(fn, {
    timeout: opts?.timeoutMs ?? 15_000,
  });
}
