import { createHash } from "node:crypto";
import { parse } from "csv-parse/sync";
import type { ImportJob, PrismaClient } from "@hh/database";
import { prisma as defaultPrisma } from "@hh/database";
import { REQUIRED_COLUMNS, importRowSchema } from "./row-schema";

const CHUNK_SIZE = 100;
/** Trigram similarity floor for flagging near-duplicate names. */
const NAME_SIMILARITY_THRESHOLD = 0.55;

export interface ImportStats {
  created: number;
  updated: number;
  skippedDuplicate: number;
  errors: number;
  dryRun: boolean;
}

interface RowOutcome {
  status: "created" | "updated" | "skipped_duplicate" | "error";
  matchedFoodId?: string | undefined;
  matchMethod?: string | undefined;
  matchScore?: number | undefined;
  errors?: Array<{ field: string; code: string; message: string }> | undefined;
}

function slugify(name: string): string {
  return (
    name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100) ||
    "food"
  );
}

function sha256(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

/**
 * Executes an import job: parse → validate → match → apply, in checkpointed
 * chunks. Each chunk commits food writes AND the checkpoint row in one
 * transaction, so a crash retries from the last complete chunk without
 * duplicating rows. Cancellation is honored between chunks.
 */
export class ImportRunner {
  constructor(private readonly prisma: PrismaClient = defaultPrisma) {}

  async run(jobId: string, fileContent: Buffer): Promise<ImportStats> {
    let job = await this.prisma.importJob.findUniqueOrThrow({ where: { id: jobId } });
    const stats: ImportStats = {
      created: 0,
      updated: 0,
      skippedDuplicate: 0,
      errors: 0,
      dryRun: job.isDryRun,
    };
    // Resume support: fold previous stats in on retry.
    const prior = (job.stats ?? {}) as Partial<ImportStats>;
    stats.created += prior.created ?? 0;
    stats.updated += prior.updated ?? 0;
    stats.skippedDuplicate += prior.skippedDuplicate ?? 0;
    stats.errors += prior.errors ?? 0;

    const fail = async (message: string): Promise<never> => {
      await this.prisma.importJob.update({
        where: { id: jobId },
        data: { status: "failed", errorSummary: message, finishedAt: new Date() },
      });
      throw new Error(message);
    };

    // --- validating -------------------------------------------------------
    await this.setStatus(jobId, "validating");
    let records: Array<Record<string, string>>;
    try {
      if ((job.sourceFileName ?? "").endsWith(".json")) {
        const parsed = JSON.parse(fileContent.toString("utf8")) as unknown;
        if (!Array.isArray(parsed)) return await fail("JSON import must be an array of row objects");
        records = parsed as Array<Record<string, string>>;
      } else {
        records = parse(fileContent, {
          columns: true,
          bom: true,
          skip_empty_lines: true,
          trim: true,
        }) as Array<Record<string, string>>;
      }
    } catch (err) {
      return await fail(`file parse error: ${(err as Error).message}`);
    }
    if (records.length === 0) return await fail("file contains no rows");
    const first = records[0]!;
    const missingColumns = REQUIRED_COLUMNS.filter((c) => !(c in first));
    if (missingColumns.length > 0) {
      return await fail(`missing required columns: ${missingColumns.join(", ")}`);
    }

    // --- parsing ----------------------------------------------------------
    await this.prisma.importJob.update({
      where: { id: jobId },
      data: { status: "parsing", totalRows: records.length, startedAt: job.startedAt ?? new Date() },
    });

    // --- matching + importing, chunked ------------------------------------
    await this.setStatus(jobId, "matching");
    const startRow = job.checkpointRow; // rows before this are already done
    await this.setStatus(jobId, "importing");

    for (let offset = startRow; offset < records.length; offset += CHUNK_SIZE) {
      job = await this.prisma.importJob.findUniqueOrThrow({ where: { id: jobId } });
      if (job.status === "cancelled") {
        return stats;
      }
      const chunk = records.slice(offset, offset + CHUNK_SIZE);

      await this.prisma.$transaction(
        async (tx) => {
          for (let i = 0; i < chunk.length; i += 1) {
            const rowNumber = offset + i + 1; // 1-based, excluding header
            const raw = chunk[i]!;
            const outcome = await this.processRow(tx as unknown as PrismaClient, job, raw);
            if (outcome.status === "created") stats.created += 1;
            else if (outcome.status === "updated") stats.updated += 1;
            else if (outcome.status === "skipped_duplicate") stats.skippedDuplicate += 1;
            else stats.errors += 1;

            await tx.importJobRow.upsert({
              where: { jobId_rowNumber: { jobId, rowNumber } },
              update: {
                status: outcome.status,
                matchedFoodId: outcome.matchedFoodId ?? null,
                matchMethod: outcome.matchMethod ?? null,
                matchScore: outcome.matchScore ?? null,
                ...(outcome.errors ? { errors: outcome.errors } : {}),
                ...(outcome.status === "error" ? { rawData: raw } : {}),
              },
              create: {
                jobId,
                rowNumber,
                status: outcome.status,
                externalId: raw.external_id ?? null,
                matchedFoodId: outcome.matchedFoodId ?? null,
                matchMethod: outcome.matchMethod ?? null,
                matchScore: outcome.matchScore ?? null,
                ...(outcome.errors ? { errors: outcome.errors } : {}),
                ...(outcome.status === "error" ? { rawData: raw } : {}),
              },
            });
          }
          // Checkpoint commits atomically with this chunk's writes.
          await tx.importJob.update({
            where: { id: jobId },
            data: { checkpointRow: Math.min(offset + CHUNK_SIZE, records.length), stats: { ...stats } },
          });
        },
        { timeout: 120_000 },
      );
    }

    const succeeded = stats.created + stats.updated + stats.skippedDuplicate;
    const finalStatus =
      stats.errors === 0 ? "completed" : succeeded > 0 ? "partially_completed" : "failed";
    await this.prisma.importJob.update({
      where: { id: jobId },
      data: { status: finalStatus, stats: { ...stats }, finishedAt: new Date() },
    });
    return stats;
  }

  private async setStatus(jobId: string, status: ImportJob["status"]): Promise<void> {
    await this.prisma.importJob.update({ where: { id: jobId }, data: { status } });
  }

  /** Validate, match, and (unless dry-run) apply one row. */
  private async processRow(
    tx: PrismaClient,
    job: ImportJob,
    raw: Record<string, string>,
  ): Promise<RowOutcome> {
    const parsed = importRowSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        status: "error",
        errors: parsed.error.issues.map((issue) => ({
          field: issue.path.map(String).join(".") || "(row)",
          code: issue.code,
          message: issue.message,
        })),
      };
    }
    const row = parsed.data;

    // --- duplicate detection, in specificity order ------------------------
    let matchedFoodId: string | undefined;
    let matchMethod: string | undefined;
    let matchScore: number | undefined;

    const bySource = await tx.foodSourceRecord.findUnique({
      where: { providerId_externalId: { providerId: job.providerId, externalId: row.external_id } },
      select: { foodId: true },
    });
    if (bySource) {
      matchedFoodId = bySource.foodId;
      matchMethod = "external_id";
      matchScore = 1;
    }
    if (!matchedFoodId && row.barcode) {
      const byBarcode = await tx.barcode.findFirst({
        where: { code: row.barcode, isActive: true },
        select: { foodId: true },
      });
      if (byBarcode) {
        matchedFoodId = byBarcode.foodId;
        matchMethod = "barcode";
        matchScore = 1;
      }
    }
    if (!matchedFoodId) {
      const byName = await tx.$queryRaw<Array<{ id: string; sim: number }>>`
        SELECT id, GREATEST(similarity(name_ar_norm, normalize_arabic(${row.name_ar})),
                            similarity(name_en_norm, normalize_arabic(${row.name_en}))) AS sim
        FROM foods
        WHERE deleted_at IS NULL AND (
          name_ar_norm = normalize_arabic(${row.name_ar})
          OR name_en_norm = normalize_arabic(${row.name_en})
          OR name_ar_norm % normalize_arabic(${row.name_ar})
        )
        ORDER BY sim DESC LIMIT 1`;
      const hit = byName[0];
      if (hit && hit.sim >= NAME_SIMILARITY_THRESHOLD) {
        matchedFoodId = hit.id;
        matchMethod = hit.sim >= 0.999 ? "name_exact" : "trgm_similarity";
        matchScore = Math.round(hit.sim * 1000) / 1000;
      }
    }

    // --- apply mode -------------------------------------------------------
    if (matchedFoodId && job.mode === "create_only") {
      return {
        status: "skipped_duplicate",
        matchedFoodId,
        ...(matchMethod !== undefined ? { matchMethod } : {}),
        ...(matchScore !== undefined ? { matchScore } : {}),
      };
    }
    if (!matchedFoodId && job.mode === "update_existing") {
      return {
        status: "error",
        errors: [{ field: "external_id", code: "no_match", message: "no existing food matched in update_existing mode" }],
      };
    }

    if (job.isDryRun) {
      // Report what WOULD happen; write nothing.
      return matchedFoodId
        ? { status: "updated", matchedFoodId, matchMethod, matchScore }
        : { status: "created" };
    }

    const nutrientRows = (
      [
        ["energy_kcal", row.energy_kcal],
        ["protein_g", row.protein_g],
        ["carbs_g", row.carbs_g],
        ["fat_g", row.fat_g],
        ["sat_fat_g", row.sat_fat_g],
        ["fiber_g", row.fiber_g],
        ["sugars_g", row.sugars_g],
        ["sodium_mg", row.sodium_mg],
        ["cholesterol_mg", row.cholesterol_mg],
      ] as Array<[string, number | undefined]>
    ).filter((entry): entry is [string, number] => entry[1] !== undefined);
    const denorm = Object.fromEntries(nutrientRows);

    const category = row.category_slug
      ? await tx.foodCategory.findUnique({ where: { slug: row.category_slug }, select: { id: true } })
      : null;
    const brand = row.brand_slug
      ? await tx.brand.findUnique({ where: { slug: row.brand_slug }, select: { id: true } })
      : null;

    const payloadChecksum = sha256(JSON.stringify(raw));

    let foodId: string;
    if (matchedFoodId) {
      foodId = matchedFoodId;
      await tx.food.update({
        where: { id: foodId },
        data: {
          nameAr: row.name_ar,
          nameEn: row.name_en,
          foodType: row.food_type,
          preparationState: row.preparation_state,
          categoryId: category?.id ?? null,
          brandId: brand?.id ?? null,
          defaultPortionGrams: row.default_portion_grams ?? null,
          nutrientsDenorm: denorm,
          reviewStatus: "normalized",
          rowVersion: { increment: 1 },
        },
      });
      await tx.foodNutrient.deleteMany({ where: { foodId } });
    } else {
      const base = slugify(row.name_en);
      let slug = base;
      for (let n = 2; ; n += 1) {
        const exists = await tx.food.findUnique({ where: { slug }, select: { id: true } });
        if (!exists) break;
        slug = `${base}-${n}`;
      }
      const created = await tx.food.create({
        data: {
          slug,
          nameAr: row.name_ar,
          nameEn: row.name_en,
          foodType: row.food_type,
          preparationState: row.preparation_state,
          categoryId: category?.id ?? null,
          brandId: brand?.id ?? null,
          defaultPortionGrams: row.default_portion_grams ?? null,
          marketTags: ["IQ"],
          nutrientsDenorm: denorm,
          reviewStatus: "normalized",
          createdById: job.createdById,
        },
        select: { id: true },
      });
      foodId = created.id;
    }

    const nutrientDefs = await tx.nutrientDefinition.findMany({
      where: { key: { in: nutrientRows.map(([k]) => k) } },
      select: { id: true, key: true },
    });
    const idByKey = new Map(nutrientDefs.map((d) => [d.key, d.id]));
    await tx.foodNutrient.createMany({
      data: nutrientRows
        .filter(([key]) => idByKey.has(key))
        .map(([key, value]) => ({ foodId, nutrientId: idByKey.get(key)!, valuePer100g: value })),
      skipDuplicates: true,
    });

    // Aliases (deduped by the (food, alias_norm, kind) unique index).
    const aliasSpecs: Array<{ alias: string; kind: "iraqi_dialect" | "english" }> = [
      ...(row.aliases_iraqi ?? "").split("|").filter(Boolean).map((alias) => ({ alias: alias.trim(), kind: "iraqi_dialect" as const })),
      ...(row.aliases_en ?? "").split("|").filter(Boolean).map((alias) => ({ alias: alias.trim(), kind: "english" as const })),
    ].filter((a) => a.alias.length > 0);
    for (const spec of aliasSpecs) {
      // ON CONFLICT DO NOTHING — a caught unique violation would abort the
      // surrounding Postgres transaction, so error-catching is not an option.
      await tx.$executeRaw`
        INSERT INTO food_aliases (id, food_id, alias, kind, locale, source, created_at)
        VALUES (gen_random_uuid(), ${foodId}::uuid, ${spec.alias}, ${spec.kind}::"AliasKind", NULL, ${"import:" + job.id}, now())
        ON CONFLICT (food_id, alias_norm, kind) DO NOTHING`;
    }

    if (row.barcode) {
      const holder = await tx.barcode.findFirst({ where: { code: row.barcode, isActive: true } });
      if (!holder) {
        await tx.barcode.create({ data: { foodId, code: row.barcode, source: `import:${job.id}` } });
      }
    }

    if (row.portion_label_ar && row.portion_label_en && row.portion_grams) {
      const existingPortion = await tx.foodPortion.findFirst({
        where: { foodId, labelEn: row.portion_label_en },
      });
      if (!existingPortion) {
        await tx.foodPortion.create({
          data: {
            foodId,
            labelAr: row.portion_label_ar,
            labelEn: row.portion_label_en,
            grams: row.portion_grams,
            source: "provider",
            confidence: 0.7,
            locale: "ar-IQ",
            isDefault: true,
          },
        });
      }
    }

    // Provenance (upsert keeps re-imports idempotent).
    await tx.foodSourceRecord.upsert({
      where: { providerId_externalId: { providerId: job.providerId, externalId: row.external_id } },
      update: { originalPayload: raw, payloadChecksum, importJobId: job.id, importedAt: new Date() },
      create: {
        foodId,
        providerId: job.providerId,
        externalId: row.external_id,
        originalPayload: raw,
        payloadChecksum,
        transformationVersion: "normalizer@1",
        importJobId: job.id,
      },
    });

    return matchedFoodId
      ? {
          status: "updated",
          matchedFoodId,
          ...(matchMethod !== undefined ? { matchMethod } : {}),
          ...(matchScore !== undefined ? { matchScore } : {}),
        }
      : { status: "created" };
  }

}
