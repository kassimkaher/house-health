/**
 * Local TypeScript types mirroring JSON response shapes for admin API
 * resources that aren't published as Zod contracts in @hh/contracts (those
 * come straight from Prisma model selections in apps/api). Kept in sync by
 * hand with packages/database/prisma/schema.prisma — admin-web intentionally
 * does not depend on @hh/database (a server-only package pulling in
 * @prisma/client) or @hh/auth (pulls in @nestjs/common).
 *
 * Prisma Decimal fields serialize to JSON strings (Decimal#toJSON); BigInt
 * fields are serialized to string by the controllers that expose them.
 */

// --- Enums ------------------------------------------------------------------

export type FoodType = "generic_food" | "branded_product" | "prepared_dish" | "recipe_template" | "user_recipe";
export type PreparationState = "raw" | "cooked" | "baked" | "grilled" | "fried" | "steamed" | "canned" | "dried" | "other";
export type ReviewStatus = "imported" | "normalized" | "needs_review" | "verified" | "rejected" | "archived";
export type PublicationStatus = "draft" | "published" | "deprecated";
export type AliasKind = "iraqi_dialect" | "msa_variant" | "english" | "transliteration" | "colloquial_other" | "brand_variant";
export type BarcodeType = "ean13" | "ean8" | "upc_a" | "upc_e" | "code128" | "other";
export type PortionSource = "provider" | "curated" | "user_submitted" | "inferred";

export type ImportJobStatus =
  | "queued"
  | "validating"
  | "parsing"
  | "normalizing"
  | "matching"
  | "importing"
  | "completed"
  | "partially_completed"
  | "failed"
  | "cancelled";
export type ImportMode = "create_only" | "update_existing" | "upsert";
export type ImportRowStatus = "pending" | "created" | "updated" | "skipped_duplicate" | "skipped_invalid" | "error";

export type ReleaseStatus = "draft" | "candidate" | "published" | "rolled_back" | "archived";
export type MediaAssetStatus = "pending" | "ready" | "rejected";
export type AccountStatus = "pending_verification" | "active" | "suspended" | "deleted";

// --- Users --------------------------------------------------------------

export interface AdminUserListItem {
  id: string;
  email: string;
  roles: string[];
  status: AccountStatus;
  emailVerifiedAt: string | null;
  createdAt: string;
  deletedAt: string | null;
}

export interface AdminUserDetail extends AdminUserListItem {
  profile: { displayName: string | null; locale: string | null; timezone: string | null } | null;
  activeSessionCount: number;
}

export interface Paginated<T> {
  items: T[];
  nextCursor: string | null;
}

// --- Catalog: taxonomy ----------------------------------------------------

export interface FoodCategory {
  id: string;
  slug: string;
  nameAr: string;
  nameEn: string;
  parentId: string | null;
  sortOrder: number;
  rowVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface Brand {
  id: string;
  slug: string;
  nameAr: string | null;
  nameEn: string;
  manufacturer: string | null;
  countryCode: string | null;
  rowVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface NutrientDefinition {
  id: string;
  key: string;
  nameAr: string;
  nameEn: string;
  unit: "kcal" | "kJ" | "g" | "mg" | "µg";
  isCore: boolean;
  displayOrder: number;
  precision: number;
  rowVersion: number;
}

// --- Catalog: foods ---------------------------------------------------------

export interface FoodAlias {
  id: string;
  foodId: string;
  alias: string;
  aliasNorm: string | null;
  kind: AliasKind;
  locale: string | null;
  source: string | null;
  createdAt: string;
}

export interface FoodNutrientRow {
  foodId: string;
  nutrientId: string;
  nutrient: NutrientDefinition;
  valuePer100g: string;
  originalValue: string | null;
  originalUnit: string | null;
  originalBasis: string | null;
  derivation: string | null;
  updatedAt: string;
}

export interface Barcode {
  id: string;
  foodId: string;
  code: string;
  type: BarcodeType;
  isActive: boolean;
  source: string | null;
  createdAt: string;
}

export interface FoodPortion {
  id: string;
  foodId: string;
  labelAr: string;
  labelEn: string;
  grams: string;
  source: PortionSource;
  confidence: string;
  reviewStatus: ReviewStatus;
  locale: string | null;
  isDefault: boolean;
  sortOrder: number;
  rowVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface FoodSourceRecord {
  id: string;
  foodId: string;
  providerId: string;
  provider: { id: string; key: string; name: string };
  externalId: string;
  originalPayload: unknown;
  payloadChecksum: string;
  transformationVersion: string;
  importJobId: string | null;
  importedAt: string;
  reviewerId: string | null;
  reviewerNotes: string | null;
}

export interface AdminFood {
  id: string;
  slug: string;
  foodType: FoodType;
  nameAr: string;
  nameEn: string;
  descriptionAr: string | null;
  descriptionEn: string | null;
  categoryId: string | null;
  category: FoodCategory | null;
  preparationState: PreparationState;
  brandId: string | null;
  brand: Brand | null;
  defaultPortionGrams: string | null;
  densityGPerMl: string | null;
  edibleFraction: string | null;
  marketTags: string[];
  dietaryTags: string[];
  allergenTags: string[];
  dataConfidence: string;
  reviewStatus: ReviewStatus;
  publicationStatus: PublicationStatus;
  nutrientsDenorm: Record<string, number> | null;
  ownerUserId: string | null;
  createdById: string | null;
  reviewedById: string | null;
  reviewedAt: string | null;
  reviewNotes: string | null;
  publishedAt: string | null;
  rowVersion: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  aliases: FoodAlias[];
  nutrients: FoodNutrientRow[];
  barcodes: Barcode[];
  portions: FoodPortion[];
  sourceRecords: FoodSourceRecord[];
}

export interface DuplicateCandidate {
  foodIdA: string;
  foodIdB: string;
  nameEnA: string;
  nameEnB: string;
  similarity: number;
}

// --- Imports ------------------------------------------------------------

export interface ImportJob {
  id: string;
  providerId: string;
  provider: { key: string; name: string };
  status: ImportJobStatus;
  mode: ImportMode;
  isDryRun: boolean;
  sourceFileKey: string | null;
  sourceFileName: string | null;
  sourceFileChecksum: string | null;
  mappingConfig: unknown;
  duplicatePolicy: unknown;
  totalRows: number | null;
  checkpointRow: number;
  stats: {
    created?: number;
    updated?: number;
    skipped?: number;
    errors?: number;
    flaggedDuplicates?: number;
  } | null;
  errorSummary: string | null;
  idempotencyKey: string | null;
  createdById: string;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

export interface DataProvider {
  id: string;
  key: string;
  name: string;
  licenseName: string;
  licenseUrl: string | null;
  attributionRequired: boolean;
}

// --- Releases -----------------------------------------------------------

export interface DatasetRelease {
  id: string;
  version: string;
  status: ReleaseStatus;
  isActive: boolean;
  notes: string | null;
  ownerId: string;
  foodCount: number | null;
  addedCount: number | null;
  changedCount: number | null;
  removedCount: number | null;
  checksum: string | null;
  publishedAt: string | null;
  rolledBackAt: string | null;
  createdAt: string;
}

export interface ReleaseCompareResult {
  added: string[];
  changed: string[];
  removed: string[];
  [key: string]: unknown;
}

// --- Calc policies --------------------------------------------------------

export interface CalculationPolicy {
  id: string;
  key: string;
  version: number;
  isActive: boolean;
  config: Record<string, unknown>;
  notes: string | null;
  createdAt: string;
}

// --- Jobs -----------------------------------------------------------------

export interface QueueSummary {
  name: string;
  waiting: number;
  active: number;
  delayed: number;
  completed: number;
  failed: number;
}

export interface FailedJob {
  queue: string;
  id: string | undefined;
  name: string;
  failedReason: string;
  timestamp: number;
}

// --- Audit ------------------------------------------------------------------

export interface AuditLogEntry {
  id: string;
  actorId: string | null;
  actorRoles: string[];
  action: string;
  entityType: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  ip: string | null;
  requestId: string | null;
  createdAt: string;
}

// --- System -----------------------------------------------------------------

export interface SystemOverview {
  users: { total: number; active: number };
  catalog: { totalFoods: number; needsReview: number; publishedInActiveRelease: number };
  activeRelease: { version: string; publishedAt: string | null; foodCount: number | null } | null;
  recentImportJobs: Array<{ id: string; status: ImportJobStatus; createdAt: string; mode: ImportMode }>;
  pendingMediaAssets: number;
}

export interface MediaAsset {
  id: string;
  bucket: string;
  key: string;
  contentType: string;
  sizeBytes: string | null;
  checksum: string | null;
  status: MediaAssetStatus;
  kind: string;
  ownerUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SystemMedia {
  items: MediaAsset[];
  pendingCount: number;
  rejectedCount: number;
}

export interface HealthCheck {
  status: "ok" | "error";
  error?: string;
}

export interface HealthReady {
  status: "ok" | "error";
  checks: Record<string, HealthCheck>;
}
