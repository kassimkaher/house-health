import { Controller, Get, HttpCode, Inject, ServiceUnavailableException } from "@nestjs/common";
import { REDIS, Public } from "@hh/auth";
import { OBJECT_STORAGE, type ObjectStorage } from "@hh/storage";
import type Redis from "ioredis";
import { PrismaService } from "../infra/prisma.service";

interface DependencyCheck {
  status: "ok" | "error";
  error?: string;
}

const TIMEOUT_MS = 2000;

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)),
  ]);
}

@Public()
@Controller("health")
export class HealthController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  @Get("live")
  live(): { status: "ok" } {
    return { status: "ok" };
  }

  @Get("ready")
  @HttpCode(200)
  async ready(): Promise<{ status: "ok"; checks: Record<string, DependencyCheck> }> {
    const [postgres, redis, storage] = await Promise.all([
      this.check(() => withTimeout(this.prisma.$queryRaw`SELECT 1`, TIMEOUT_MS)),
      this.check(() => withTimeout(this.redis.ping(), TIMEOUT_MS)),
      this.check(() => withTimeout(this.storage.ping(), TIMEOUT_MS)),
    ]);
    const checks = { postgres, redis, storage };
    const allOk = Object.values(checks).every((c) => c.status === "ok");
    if (!allOk) {
      throw new ServiceUnavailableException({ status: "error", checks });
    }
    return { status: "ok", checks };
  }

  private async check(fn: () => Promise<unknown>): Promise<DependencyCheck> {
    try {
      await fn();
      return { status: "ok" };
    } catch (err) {
      return { status: "error", error: (err as Error).message };
    }
  }
}
