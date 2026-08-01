import { createHash } from "node:crypto";
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UnprocessableEntityException,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Queue } from "bullmq";
import { stringify } from "csv-stringify/sync";
import { CurrentUser, RequirePermission, type RequestUser } from "@hh/auth";
import type { ImportJob, Prisma } from "@hh/database";
import { ERROR_CODES, ZodValidationPipe } from "@hh/contracts";
import { jobIds } from "@hh/pipeline";
import { OBJECT_STORAGE, type ObjectStorage } from "@hh/storage";
import { z } from "zod";
import { AuditService } from "../auth/audit.service";
import { PrismaService } from "../infra/prisma.service";
import { IMPORTS_QUEUE } from "../infra/queues.module";

const createImportSchema = z
  .object({
    providerKey: z.string().min(1).max(60),
    mode: z.enum(["create_only", "update_existing", "upsert"]).default("upsert"),
    isDryRun: z
      .union([z.boolean(), z.enum(["true", "false"])])
      .default(false)
      .transform((v) => v === true || v === "true"),
  })
  .strict();
type CreateImportDto = z.infer<typeof createImportSchema>;

const listImportsSchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(25),
    cursor: z.string().uuid().optional(),
  })
  .strict();

@ApiTags("admin/imports")
@ApiBearerAuth()
@Controller("admin/imports")
export class ImportsAdminController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(IMPORTS_QUEUE) private readonly importsQueue: Queue,
  ) {}

  @Post()
  @RequirePermission("imports.run")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 25 * 1024 * 1024 } }))
  @ApiConsumes("multipart/form-data")
  @ApiOperation({ summary: "Upload a CSV/JSON dataset file and start an import job" })
  async create(
    @CurrentUser() user: RequestUser,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body(new ZodValidationPipe(createImportSchema)) dto: CreateImportDto,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
  ): Promise<ImportJob> {
    if (!file) {
      throw new BadRequestException({
        code: ERROR_CODES.VALIDATION_FAILED,
        fields: [{ path: "file", message: "multipart file field 'file' is required" }],
      });
    }
    if (!/\.(csv|json)$/i.test(file.originalname)) {
      throw new UnprocessableEntityException({
        code: ERROR_CODES.VALIDATION_FAILED,
        fields: [{ path: "file", message: "only .csv or .json files are supported" }],
      });
    }
    const provider = await this.prisma.dataProvider.findUnique({ where: { key: dto.providerKey } });
    if (!provider) {
      throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND, entity: "data_provider" });
    }
    if (idempotencyKey) {
      const existing = await this.prisma.importJob.findUnique({ where: { idempotencyKey } });
      if (existing) return existing;
    }

    const checksum = createHash("sha256").update(file.buffer).digest("hex");
    const job = await this.prisma.importJob.create({
      data: {
        providerId: provider.id,
        mode: dto.mode,
        isDryRun: dto.isDryRun,
        sourceFileName: file.originalname,
        sourceFileChecksum: checksum,
        createdById: user.userId,
        ...(idempotencyKey ? { idempotencyKey } : {}),
      },
    });
    const fileKey = `import-jobs/${job.id}/${file.originalname}`;
    await this.storage.putObject("imports", fileKey, file.buffer, {
      contentType: file.mimetype || "text/csv",
    });
    await this.prisma.importJob.update({ where: { id: job.id }, data: { sourceFileKey: fileKey } });

    await this.importsQueue.add(
      "run",
      { importJobId: job.id },
      { jobId: jobIds.importRun(job.id) },
    );
    await this.audit.append({
      actorId: user.userId,
      action: "import.create",
      entityType: "import_job",
      entityId: job.id,
      after: { provider: dto.providerKey, mode: dto.mode, isDryRun: dto.isDryRun, file: file.originalname, checksum },
    });
    return this.prisma.importJob.findUniqueOrThrow({ where: { id: job.id } });
  }

  @Get()
  @RequirePermission("imports.run")
  @ApiOperation({ summary: "List import jobs, newest first" })
  async list(@Query(new ZodValidationPipe(listImportsSchema)) query: z.infer<typeof listImportsSchema>): Promise<{
    items: Array<Prisma.ImportJobGetPayload<{ include: { provider: { select: { key: true; name: true } } } }>>;
    nextCursor: string | null;
  }> {
    const items = await this.prisma.importJob.findMany({
      orderBy: { createdAt: "desc" },
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      include: { provider: { select: { key: true, name: true } } },
    });
    const nextCursor = items.length > query.limit ? (items.pop()?.id ?? null) : null;
    return { items, nextCursor };
  }

  @Get(":id")
  @RequirePermission("imports.run")
  async get(
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<Prisma.ImportJobGetPayload<{ include: { provider: { select: { key: true; name: true } } } }>> {
    const job = await this.prisma.importJob.findUnique({
      where: { id },
      include: { provider: { select: { key: true, name: true } } },
    });
    if (!job) throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND });
    return job;
  }

  @Get(":id/errors.csv")
  @RequirePermission("imports.run")
  @Header("content-type", "text/csv; charset=utf-8")
  @ApiOperation({ summary: "Row-level error report as CSV" })
  async errorReport(@Param("id", ParseUUIDPipe) id: string): Promise<string> {
    await this.get(id);
    const rows = await this.prisma.importJobRow.findMany({
      where: { jobId: id, status: "error" },
      orderBy: { rowNumber: "asc" },
    });
    return stringify(
      rows.map((row) => ({
        row_number: row.rowNumber,
        external_id: row.externalId ?? "",
        errors: JSON.stringify(row.errors ?? []),
        raw_data: JSON.stringify(row.rawData ?? {}),
      })),
      { header: true },
    );
  }

  @Post(":id/retry")
  @HttpCode(202)
  @RequirePermission("imports.run")
  @ApiOperation({ summary: "Retry a failed/cancelled job from its checkpoint" })
  async retry(@CurrentUser() user: RequestUser, @Param("id", ParseUUIDPipe) id: string) {
    const job = await this.get(id);
    if (!["failed", "partially_completed", "cancelled"].includes(job.status)) {
      throw new ConflictException({ code: ERROR_CODES.CATALOG_INVALID_TRANSITION, from: job.status });
    }
    const attempt = Math.floor(Date.now() / 1000);
    await this.prisma.importJob.update({ where: { id }, data: { status: "queued", errorSummary: null } });
    await this.importsQueue.add(
      "run",
      { importJobId: id },
      { jobId: jobIds.importRetry(id, attempt) },
    );
    await this.audit.append({ actorId: user.userId, action: "import.retry", entityType: "import_job", entityId: id });
    return { status: "queued", resumesFromRow: job.checkpointRow };
  }

  @Post(":id/cancel")
  @HttpCode(202)
  @RequirePermission("imports.run")
  @ApiOperation({ summary: "Request cancellation (honored between chunks)" })
  async cancel(@CurrentUser() user: RequestUser, @Param("id", ParseUUIDPipe) id: string) {
    const job = await this.get(id);
    if (["completed", "failed", "cancelled"].includes(job.status)) {
      throw new ConflictException({ code: ERROR_CODES.CATALOG_INVALID_TRANSITION, from: job.status });
    }
    await this.prisma.importJob.update({ where: { id }, data: { status: "cancelled" } });
    await this.audit.append({ actorId: user.userId, action: "import.cancel", entityType: "import_job", entityId: id });
    return { status: "cancelled" };
  }
}
