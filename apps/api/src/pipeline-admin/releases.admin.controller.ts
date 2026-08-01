import {
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  UnprocessableEntityException,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Queue } from "bullmq";
import { CurrentUser, RequirePermission, type RequestUser } from "@hh/auth";
import { ERROR_CODES, ZodValidationPipe } from "@hh/contracts";
import { ReleaseError, ReleaseService, jobIds } from "@hh/pipeline";
import { z } from "zod";
import { AuditService } from "../auth/audit.service";
import { PrismaService } from "../infra/prisma.service";
import { CATALOG_QUEUE } from "../infra/queues.module";

const buildReleaseSchema = z
  .object({
    version: z.string().regex(/^\d{4}\.\d{2}\.\d+$/, "calver like 2026.08.0"),
    notes: z.string().trim().max(4000).optional(),
  })
  .strict();

function mapReleaseError(err: unknown): never {
  if (err instanceof ReleaseError) {
    if (err.code === "release.not_found") throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND });
    if (err.code === "release.version_exists") throw new ConflictException({ code: err.code });
    throw new UnprocessableEntityException({ code: err.code, message: err.message });
  }
  throw err;
}

@ApiTags("admin/releases")
@ApiBearerAuth()
@Controller("admin/releases")
export class ReleasesAdminController {
  private readonly releases: ReleaseService;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(CATALOG_QUEUE) private readonly catalogQueue: Queue,
  ) {
    this.releases = new ReleaseService(this.prisma);
  }

  @Get()
  @RequirePermission("releases.publish")
  @ApiOperation({ summary: "All dataset releases, newest first" })
  list() {
    return this.prisma.datasetRelease.findMany({ orderBy: { createdAt: "desc" } });
  }

  @Get(":id")
  @RequirePermission("releases.publish")
  async get(@Param("id", ParseUUIDPipe) id: string) {
    const release = await this.prisma.datasetRelease.findUnique({ where: { id } });
    if (!release) throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND });
    return release;
  }

  @Post()
  @HttpCode(202)
  @RequirePermission("releases.publish")
  @ApiOperation({ summary: "Build a release candidate from verified foods (async, worker)" })
  async build(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(buildReleaseSchema)) dto: z.infer<typeof buildReleaseSchema>,
  ) {
    const existing = await this.prisma.datasetRelease.findUnique({ where: { version: dto.version } });
    if (existing) throw new ConflictException({ code: "release.version_exists" });
    await this.catalogQueue.add(
      "release-build",
      { version: dto.version, ownerId: user.userId, notes: dto.notes },
      { jobId: jobIds.releaseBuild(dto.version) },
    );
    await this.audit.append({
      actorId: user.userId,
      action: "release.build.requested",
      entityType: "dataset_release",
      after: { version: dto.version },
    });
    return { status: "building", version: dto.version };
  }

  @Get(":id/compare/:otherId")
  @RequirePermission("releases.publish")
  @ApiOperation({ summary: "Diff two releases (added/removed/changed food ids)" })
  async compare(
    @Param("id", ParseUUIDPipe) id: string,
    @Param("otherId", ParseUUIDPipe) otherId: string,
  ) {
    await this.get(id);
    await this.get(otherId);
    return this.releases.compare(id, otherId);
  }

  @Post(":id/publish")
  @HttpCode(200)
  @RequirePermission("releases.publish")
  @ApiOperation({ summary: "Atomically activate this release for the public API" })
  async publish(@CurrentUser() user: RequestUser, @Param("id", ParseUUIDPipe) id: string) {
    try {
      const release = await this.releases.publish(id);
      await this.audit.append({
        actorId: user.userId,
        action: "release.publish",
        entityType: "dataset_release",
        entityId: id,
        after: { version: release.version },
      });
      return release;
    } catch (err) {
      mapReleaseError(err);
    }
  }

  @Post(":id/rollback")
  @HttpCode(200)
  @RequirePermission("releases.publish")
  @ApiOperation({ summary: "Re-activate this (prior) release; current one becomes rolled_back" })
  async rollback(@CurrentUser() user: RequestUser, @Param("id", ParseUUIDPipe) id: string) {
    try {
      const release = await this.releases.rollbackTo(id);
      await this.audit.append({
        actorId: user.userId,
        action: "release.rollback",
        entityType: "dataset_release",
        entityId: id,
        after: { version: release.version },
      });
      return release;
    } catch (err) {
      mapReleaseError(err);
    }
  }

  @Post(":id/archive")
  @HttpCode(200)
  @RequirePermission("releases.publish")
  async archive(@CurrentUser() user: RequestUser, @Param("id", ParseUUIDPipe) id: string) {
    try {
      const release = await this.releases.archive(id);
      await this.audit.append({
        actorId: user.userId,
        action: "release.archive",
        entityType: "dataset_release",
        entityId: id,
      });
      return release;
    } catch (err) {
      mapReleaseError(err);
    }
  }
}
