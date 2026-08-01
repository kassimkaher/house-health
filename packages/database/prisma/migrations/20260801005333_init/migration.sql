-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "btree_gin";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "citext";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "unaccent";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('user', 'nutrition_reviewer', 'data_manager', 'support_admin', 'super_admin');

-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('pending_verification', 'active', 'suspended', 'deleted');

-- CreateEnum
CREATE TYPE "AuthProvider" AS ENUM ('password', 'google');

-- CreateEnum
CREATE TYPE "AuthTokenKind" AS ENUM ('email_verify', 'password_reset');

-- CreateEnum
CREATE TYPE "Sex" AS ENUM ('male', 'female');

-- CreateEnum
CREATE TYPE "ActivityLevel" AS ENUM ('sedentary', 'light', 'moderate', 'active', 'very_active');

-- CreateEnum
CREATE TYPE "GoalType" AS ENUM ('lose', 'maintain', 'gain');

-- CreateEnum
CREATE TYPE "UnitPreference" AS ENUM ('metric', 'imperial');

-- CreateEnum
CREATE TYPE "WeightSource" AS ENUM ('manual', 'import', 'admin');

-- CreateEnum
CREATE TYPE "FoodType" AS ENUM ('generic_food', 'branded_product', 'prepared_dish', 'recipe_template', 'user_recipe');

-- CreateEnum
CREATE TYPE "PreparationState" AS ENUM ('raw', 'cooked', 'baked', 'grilled', 'fried', 'steamed', 'canned', 'dried', 'other');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('imported', 'normalized', 'needs_review', 'verified', 'rejected', 'archived');

-- CreateEnum
CREATE TYPE "PublicationStatus" AS ENUM ('draft', 'published', 'deprecated');

-- CreateEnum
CREATE TYPE "AliasKind" AS ENUM ('iraqi_dialect', 'msa_variant', 'english', 'transliteration', 'colloquial_other', 'brand_variant');

-- CreateEnum
CREATE TYPE "BarcodeType" AS ENUM ('ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'other');

-- CreateEnum
CREATE TYPE "PortionSource" AS ENUM ('provider', 'curated', 'user_submitted', 'inferred');

-- CreateEnum
CREATE TYPE "ImportJobStatus" AS ENUM ('queued', 'validating', 'parsing', 'normalizing', 'matching', 'importing', 'completed', 'partially_completed', 'failed', 'cancelled');

-- CreateEnum
CREATE TYPE "ImportMode" AS ENUM ('create_only', 'update_existing', 'upsert');

-- CreateEnum
CREATE TYPE "ImportRowStatus" AS ENUM ('pending', 'created', 'updated', 'skipped_duplicate', 'skipped_invalid', 'error');

-- CreateEnum
CREATE TYPE "ReleaseStatus" AS ENUM ('draft', 'candidate', 'published', 'rolled_back', 'archived');

-- CreateEnum
CREATE TYPE "MealSlot" AS ENUM ('breakfast', 'lunch', 'dinner', 'snack', 'custom');

-- CreateEnum
CREATE TYPE "DiaryEntryStatus" AS ENUM ('planned', 'consumed', 'skipped');

-- CreateEnum
CREATE TYPE "DiaryItemType" AS ENUM ('food', 'recipe', 'meal_group');

-- CreateEnum
CREATE TYPE "RecipeStatus" AS ENUM ('active', 'archived');

-- CreateEnum
CREATE TYPE "ShortcutEntityType" AS ENUM ('food', 'recipe', 'meal_group');

-- CreateEnum
CREATE TYPE "ShortcutKind" AS ENUM ('favorite', 'pin');

-- CreateEnum
CREATE TYPE "ReminderType" AS ENUM ('meal_slot', 'meal_group', 'hydration', 'weigh_in', 'custom');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('scheduled', 'queued', 'sent', 'failed', 'cancelled', 'skipped');

-- CreateEnum
CREATE TYPE "MediaAssetStatus" AS ENUM ('pending', 'ready', 'rejected');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" CITEXT NOT NULL,
    "email_verified_at" TIMESTAMP(3),
    "password_hash" TEXT,
    "roles" "UserRole"[] DEFAULT ARRAY['user']::"UserRole"[],
    "status" "AccountStatus" NOT NULL DEFAULT 'pending_verification',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_identities" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "provider" "AuthProvider" NOT NULL,
    "provider_subject" TEXT NOT NULL,
    "email_at_link" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "device_name" TEXT,
    "device_id" TEXT,
    "user_agent" TEXT,
    "ip_created" TEXT,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "session_id" UUID NOT NULL,
    "family_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "parent_id" UUID,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_action_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "kind" "AuthTokenKind" NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_action_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_profiles" (
    "user_id" UUID NOT NULL,
    "display_name" TEXT,
    "locale" TEXT NOT NULL DEFAULT 'ar-IQ',
    "preferred_language" TEXT NOT NULL DEFAULT 'ar',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Baghdad',
    "sex" "Sex",
    "birth_date" DATE,
    "height_cm" DECIMAL(5,1),
    "current_weight_kg" DECIMAL(5,2),
    "target_weight_kg" DECIMAL(5,2),
    "activity_level" "ActivityLevel" NOT NULL DEFAULT 'sedentary',
    "goal_type" "GoalType" NOT NULL DEFAULT 'maintain',
    "goal_rate_kg_per_week" DECIMAL(3,2),
    "dietary_prefs" TEXT[],
    "allergies" TEXT[],
    "excluded_foods" TEXT[],
    "unit_preference" "UnitPreference" NOT NULL DEFAULT 'metric',
    "medical_ack_at" TIMESTAMP(3),
    "active_calc_snapshot_id" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_profiles_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "weight_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "weight_kg" DECIMAL(5,2) NOT NULL,
    "measured_on" DATE NOT NULL,
    "source" "WeightSource" NOT NULL DEFAULT 'manual',
    "note" TEXT,
    "photo_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "weight_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calculation_policies" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "key" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "config" JSONB NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "calculation_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calculation_snapshots" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "policy_id" UUID NOT NULL,
    "inputs" JSONB NOT NULL,
    "outputs" JSONB NOT NULL,
    "effective_from" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "calculation_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "food_categories" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "slug" TEXT NOT NULL,
    "name_ar" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "parent_id" UUID,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "row_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "food_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brands" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "slug" TEXT NOT NULL,
    "name_ar" TEXT,
    "name_en" TEXT NOT NULL,
    "name_norm" TEXT,
    "manufacturer" TEXT,
    "country_code" CHAR(2),
    "row_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "brands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nutrient_definitions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "key" TEXT NOT NULL,
    "name_ar" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "is_core" BOOLEAN NOT NULL DEFAULT false,
    "display_order" INTEGER NOT NULL,
    "precision" INTEGER NOT NULL DEFAULT 1,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "nutrient_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "foods" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "slug" TEXT NOT NULL,
    "food_type" "FoodType" NOT NULL,
    "name_ar" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_ar_norm" TEXT,
    "name_en_norm" TEXT,
    "description_ar" TEXT,
    "description_en" TEXT,
    "category_id" UUID,
    "preparation_state" "PreparationState" NOT NULL DEFAULT 'other',
    "brand_id" UUID,
    "default_portion_grams" DECIMAL(8,2),
    "density_g_per_ml" DECIMAL(8,4),
    "edible_fraction" DECIMAL(4,3),
    "image_refs" JSONB,
    "market_tags" TEXT[],
    "dietary_tags" TEXT[],
    "allergen_tags" TEXT[],
    "data_confidence" DECIMAL(3,2) NOT NULL DEFAULT 0.5,
    "review_status" "ReviewStatus" NOT NULL DEFAULT 'imported',
    "publication_status" "PublicationStatus" NOT NULL DEFAULT 'draft',
    "nutrients_denorm" JSONB,
    "owner_user_id" UUID,
    "created_by_id" UUID,
    "reviewed_by_id" UUID,
    "reviewed_at" TIMESTAMP(3),
    "review_notes" TEXT,
    "published_at" TIMESTAMP(3),
    "row_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "foods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "food_aliases" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "food_id" UUID NOT NULL,
    "alias" TEXT NOT NULL,
    "alias_norm" TEXT,
    "kind" "AliasKind" NOT NULL,
    "locale" TEXT,
    "source" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "food_aliases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "food_nutrients" (
    "food_id" UUID NOT NULL,
    "nutrient_id" UUID NOT NULL,
    "value_per_100g" DECIMAL(10,3) NOT NULL,
    "original_value" DECIMAL(12,4),
    "original_unit" TEXT,
    "original_basis" TEXT,
    "derivation" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "food_nutrients_pkey" PRIMARY KEY ("food_id","nutrient_id")
);

-- CreateTable
CREATE TABLE "barcodes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "food_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "type" "BarcodeType" NOT NULL DEFAULT 'ean13',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "source" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "barcodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "food_portions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "food_id" UUID NOT NULL,
    "label_ar" TEXT NOT NULL,
    "label_en" TEXT NOT NULL,
    "grams" DECIMAL(8,2) NOT NULL,
    "source" "PortionSource" NOT NULL DEFAULT 'curated',
    "confidence" DECIMAL(3,2) NOT NULL DEFAULT 0.8,
    "review_status" "ReviewStatus" NOT NULL DEFAULT 'needs_review',
    "locale" TEXT,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "row_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "food_portions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_providers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "license_name" TEXT NOT NULL,
    "license_url" TEXT,
    "attribution_required" BOOLEAN NOT NULL DEFAULT false,
    "license_meta" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "data_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "food_source_records" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "food_id" UUID NOT NULL,
    "provider_id" UUID NOT NULL,
    "external_id" TEXT NOT NULL,
    "original_payload" JSONB NOT NULL,
    "payload_checksum" CHAR(64) NOT NULL,
    "transformation_version" TEXT NOT NULL,
    "import_job_id" UUID,
    "imported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewer_id" UUID,
    "reviewer_notes" TEXT,

    CONSTRAINT "food_source_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_jobs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "provider_id" UUID NOT NULL,
    "status" "ImportJobStatus" NOT NULL DEFAULT 'queued',
    "mode" "ImportMode" NOT NULL DEFAULT 'upsert',
    "is_dry_run" BOOLEAN NOT NULL DEFAULT false,
    "source_file_key" TEXT,
    "source_file_name" TEXT,
    "source_file_checksum" CHAR(64),
    "mapping_config" JSONB,
    "duplicate_policy" JSONB,
    "total_rows" INTEGER,
    "checkpoint_row" INTEGER NOT NULL DEFAULT 0,
    "stats" JSONB,
    "error_summary" TEXT,
    "idempotency_key" TEXT,
    "created_by_id" UUID NOT NULL,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_job_rows" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "job_id" UUID NOT NULL,
    "row_number" INTEGER NOT NULL,
    "status" "ImportRowStatus" NOT NULL DEFAULT 'pending',
    "external_id" TEXT,
    "matched_food_id" UUID,
    "match_method" TEXT,
    "match_score" DECIMAL(4,3),
    "errors" JSONB,
    "raw_data" JSONB,

    CONSTRAINT "import_job_rows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dataset_releases" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "version" TEXT NOT NULL,
    "status" "ReleaseStatus" NOT NULL DEFAULT 'draft',
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "owner_id" UUID NOT NULL,
    "food_count" INTEGER,
    "added_count" INTEGER,
    "changed_count" INTEGER,
    "removed_count" INTEGER,
    "checksum" CHAR(64),
    "published_at" TIMESTAMP(3),
    "rolled_back_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dataset_releases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "food_versions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "food_id" UUID NOT NULL,
    "version_number" INTEGER NOT NULL,
    "content_checksum" CHAR(64) NOT NULL,
    "slug" TEXT NOT NULL,
    "food_type" "FoodType" NOT NULL,
    "name_ar" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_ar_norm" TEXT,
    "name_en_norm" TEXT,
    "search_tsv" tsvector,
    "description_ar" TEXT,
    "description_en" TEXT,
    "aliases_norm" TEXT[],
    "aliases_display" JSONB,
    "brand_name" TEXT,
    "brand_name_norm" TEXT,
    "category_slug" TEXT,
    "category_path" TEXT,
    "preparation_state" "PreparationState" NOT NULL,
    "barcodes" TEXT[],
    "default_portion_grams" DECIMAL(8,2),
    "density_g_per_ml" DECIMAL(8,4),
    "edible_fraction" DECIMAL(4,3),
    "market_tags" TEXT[],
    "dietary_tags" TEXT[],
    "allergen_tags" TEXT[],
    "image_refs" JSONB,
    "nutrients" JSONB NOT NULL,
    "portions" JSONB NOT NULL,
    "data_confidence" DECIMAL(3,2) NOT NULL,
    "is_in_active_release" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "food_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "release_items" (
    "release_id" UUID NOT NULL,
    "food_id" UUID NOT NULL,
    "food_version_id" UUID NOT NULL,
    "change_kind" TEXT NOT NULL,

    CONSTRAINT "release_items_pkey" PRIMARY KEY ("release_id","food_id")
);

-- CreateTable
CREATE TABLE "recipes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "owner_user_id" UUID,
    "food_id" UUID,
    "title_ar" TEXT NOT NULL,
    "title_en" TEXT,
    "status" "RecipeStatus" NOT NULL DEFAULT 'active',
    "servings" DECIMAL(5,2) NOT NULL,
    "cooked_weight_grams" DECIMAL(8,2),
    "instructions" JSONB,
    "image_key" TEXT,
    "nutrition_totals" JSONB,
    "row_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "recipes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recipe_ingredients" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "recipe_id" UUID NOT NULL,
    "food_id" UUID NOT NULL,
    "quantity" DECIMAL(8,2) NOT NULL,
    "unit" TEXT NOT NULL,
    "grams" DECIMAL(8,2) NOT NULL,
    "preparation_note" TEXT,
    "nutrition_snapshot" JSONB NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "recipe_ingredients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meal_groups" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "name_ar" TEXT NOT NULL,
    "name_en" TEXT,
    "meal_slot" "MealSlot",
    "is_favorite" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "meal_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meal_group_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "meal_group_id" UUID NOT NULL,
    "item_type" "DiaryItemType" NOT NULL,
    "food_id" UUID,
    "recipe_id" UUID,
    "quantity" DECIMAL(8,2) NOT NULL,
    "unit" TEXT NOT NULL,
    "grams" DECIMAL(8,2),
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "meal_group_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "diary_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "entry_date" DATE NOT NULL,
    "meal_slot" "MealSlot" NOT NULL,
    "custom_slot_name" TEXT,
    "status" "DiaryEntryStatus" NOT NULL DEFAULT 'consumed',
    "item_type" "DiaryItemType" NOT NULL,
    "food_id" UUID,
    "recipe_id" UUID,
    "meal_group_id" UUID,
    "quantity" DECIMAL(8,2) NOT NULL,
    "unit" TEXT NOT NULL,
    "grams" DECIMAL(8,2),
    "nutrition_snapshot" JSONB NOT NULL,
    "note" TEXT,
    "logged_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "diary_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_shortcuts" (
    "user_id" UUID NOT NULL,
    "entity_type" "ShortcutEntityType" NOT NULL,
    "entity_id" UUID NOT NULL,
    "kind" "ShortcutKind" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_shortcuts_pkey" PRIMARY KEY ("user_id","entity_type","entity_id","kind")
);

-- CreateTable
CREATE TABLE "reminders" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "type" "ReminderType" NOT NULL,
    "meal_slot" "MealSlot",
    "meal_group_id" UUID,
    "custom_text" TEXT,
    "time_local" TEXT NOT NULL,
    "days_of_week" INTEGER[],
    "one_time_on" DATE,
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    "channel" TEXT NOT NULL DEFAULT 'push',
    "next_fire_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "reminders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reminder_deliveries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "reminder_id" UUID NOT NULL,
    "scheduled_for" TIMESTAMP(3) NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'scheduled',
    "provider" TEXT,
    "sent_at" TIMESTAMP(3),
    "fail_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reminder_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "push_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "token" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "push_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "search_query_logs" (
    "id" BIGSERIAL NOT NULL,
    "term_norm" TEXT NOT NULL,
    "result_count" INTEGER NOT NULL,
    "picked_food_id" UUID,
    "user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "search_query_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media_assets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "bucket" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" BIGINT,
    "checksum" CHAR(64),
    "status" "MediaAssetStatus" NOT NULL DEFAULT 'pending',
    "kind" TEXT NOT NULL,
    "owner_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "media_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" BIGSERIAL NOT NULL,
    "actor_id" UUID,
    "actor_roles" "UserRole"[],
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT,
    "before" JSONB,
    "after" JSONB,
    "ip" TEXT,
    "request_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" BIGSERIAL NOT NULL,
    "topic" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "key" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "request_hash" CHAR(64) NOT NULL,
    "response_status" INTEGER,
    "response_body" JSONB,
    "locked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "auth_identities_user_id_idx" ON "auth_identities"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "auth_identities_provider_provider_subject_key" ON "auth_identities"("provider", "provider_subject");

-- CreateIndex
CREATE INDEX "sessions_user_id_revoked_at_idx" ON "sessions"("user_id", "revoked_at");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_tokens_family_id_idx" ON "refresh_tokens"("family_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_session_id_idx" ON "refresh_tokens"("session_id");

-- CreateIndex
CREATE UNIQUE INDEX "auth_action_tokens_token_hash_key" ON "auth_action_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "auth_action_tokens_user_id_kind_idx" ON "auth_action_tokens"("user_id", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "weight_entries_user_id_measured_on_key" ON "weight_entries"("user_id", "measured_on");

-- CreateIndex
CREATE UNIQUE INDEX "calculation_policies_key_version_key" ON "calculation_policies"("key", "version");

-- CreateIndex
CREATE INDEX "calculation_snapshots_user_id_effective_from_idx" ON "calculation_snapshots"("user_id", "effective_from" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "food_categories_slug_key" ON "food_categories"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "brands_slug_key" ON "brands"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "nutrient_definitions_key_key" ON "nutrient_definitions"("key");

-- CreateIndex
CREATE UNIQUE INDEX "foods_slug_key" ON "foods"("slug");

-- CreateIndex
CREATE INDEX "foods_review_status_publication_status_idx" ON "foods"("review_status", "publication_status");

-- CreateIndex
CREATE INDEX "foods_category_id_idx" ON "foods"("category_id");

-- CreateIndex
CREATE INDEX "foods_brand_id_idx" ON "foods"("brand_id");

-- CreateIndex
CREATE INDEX "foods_food_type_idx" ON "foods"("food_type");

-- CreateIndex
CREATE INDEX "foods_owner_user_id_idx" ON "foods"("owner_user_id");

-- CreateIndex
CREATE INDEX "food_aliases_food_id_idx" ON "food_aliases"("food_id");

-- CreateIndex
CREATE INDEX "barcodes_food_id_idx" ON "barcodes"("food_id");

-- CreateIndex
CREATE INDEX "barcodes_code_idx" ON "barcodes"("code");

-- CreateIndex
CREATE INDEX "food_portions_food_id_idx" ON "food_portions"("food_id");

-- CreateIndex
CREATE UNIQUE INDEX "data_providers_key_key" ON "data_providers"("key");

-- CreateIndex
CREATE INDEX "food_source_records_food_id_idx" ON "food_source_records"("food_id");

-- CreateIndex
CREATE INDEX "food_source_records_payload_checksum_idx" ON "food_source_records"("payload_checksum");

-- CreateIndex
CREATE UNIQUE INDEX "food_source_records_provider_id_external_id_key" ON "food_source_records"("provider_id", "external_id");

-- CreateIndex
CREATE UNIQUE INDEX "import_jobs_idempotency_key_key" ON "import_jobs"("idempotency_key");

-- CreateIndex
CREATE INDEX "import_jobs_status_created_at_idx" ON "import_jobs"("status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "import_job_rows_job_id_status_idx" ON "import_job_rows"("job_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "import_job_rows_job_id_row_number_key" ON "import_job_rows"("job_id", "row_number");

-- CreateIndex
CREATE UNIQUE INDEX "dataset_releases_version_key" ON "dataset_releases"("version");

-- CreateIndex
CREATE INDEX "food_versions_food_id_content_checksum_idx" ON "food_versions"("food_id", "content_checksum");

-- CreateIndex
CREATE UNIQUE INDEX "food_versions_food_id_version_number_key" ON "food_versions"("food_id", "version_number");

-- CreateIndex
CREATE INDEX "release_items_food_version_id_idx" ON "release_items"("food_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "recipes_food_id_key" ON "recipes"("food_id");

-- CreateIndex
CREATE INDEX "recipes_owner_user_id_status_idx" ON "recipes"("owner_user_id", "status");

-- CreateIndex
CREATE INDEX "recipe_ingredients_recipe_id_idx" ON "recipe_ingredients"("recipe_id");

-- CreateIndex
CREATE INDEX "recipe_ingredients_food_id_idx" ON "recipe_ingredients"("food_id");

-- CreateIndex
CREATE INDEX "meal_groups_user_id_deleted_at_idx" ON "meal_groups"("user_id", "deleted_at");

-- CreateIndex
CREATE INDEX "meal_group_items_meal_group_id_idx" ON "meal_group_items"("meal_group_id");

-- CreateIndex
CREATE INDEX "diary_entries_user_id_entry_date_idx" ON "diary_entries"("user_id", "entry_date");

-- CreateIndex
CREATE INDEX "user_shortcuts_user_id_kind_idx" ON "user_shortcuts"("user_id", "kind");

-- CreateIndex
CREATE INDEX "reminders_next_fire_at_idx" ON "reminders"("next_fire_at");

-- CreateIndex
CREATE INDEX "reminders_user_id_idx" ON "reminders"("user_id");

-- CreateIndex
CREATE INDEX "reminder_deliveries_status_scheduled_for_idx" ON "reminder_deliveries"("status", "scheduled_for");

-- CreateIndex
CREATE UNIQUE INDEX "reminder_deliveries_reminder_id_scheduled_for_key" ON "reminder_deliveries"("reminder_id", "scheduled_for");

-- CreateIndex
CREATE UNIQUE INDEX "push_tokens_token_key" ON "push_tokens"("token");

-- CreateIndex
CREATE INDEX "push_tokens_user_id_idx" ON "push_tokens"("user_id");

-- CreateIndex
CREATE INDEX "search_query_logs_term_norm_idx" ON "search_query_logs"("term_norm");

-- CreateIndex
CREATE INDEX "search_query_logs_created_at_idx" ON "search_query_logs"("created_at");

-- CreateIndex
CREATE INDEX "media_assets_status_idx" ON "media_assets"("status");

-- CreateIndex
CREATE INDEX "media_assets_owner_user_id_idx" ON "media_assets"("owner_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "media_assets_bucket_key_key" ON "media_assets"("bucket", "key");

-- CreateIndex
CREATE INDEX "audit_log_entity_type_entity_id_idx" ON "audit_log"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_log_actor_id_created_at_idx" ON "audit_log"("actor_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_log_created_at_idx" ON "audit_log"("created_at");

-- CreateIndex
CREATE INDEX "outbox_events_processed_at_created_at_idx" ON "outbox_events"("processed_at", "created_at");

-- CreateIndex
CREATE INDEX "idempotency_keys_expires_at_idx" ON "idempotency_keys"("expires_at");

-- AddForeignKey
ALTER TABLE "auth_identities" ADD CONSTRAINT "auth_identities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_action_tokens" ADD CONSTRAINT "auth_action_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weight_entries" ADD CONSTRAINT "weight_entries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calculation_snapshots" ADD CONSTRAINT "calculation_snapshots_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calculation_snapshots" ADD CONSTRAINT "calculation_snapshots_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "calculation_policies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "food_categories" ADD CONSTRAINT "food_categories_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "food_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "foods" ADD CONSTRAINT "foods_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "food_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "foods" ADD CONSTRAINT "foods_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "food_aliases" ADD CONSTRAINT "food_aliases_food_id_fkey" FOREIGN KEY ("food_id") REFERENCES "foods"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "food_nutrients" ADD CONSTRAINT "food_nutrients_food_id_fkey" FOREIGN KEY ("food_id") REFERENCES "foods"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "food_nutrients" ADD CONSTRAINT "food_nutrients_nutrient_id_fkey" FOREIGN KEY ("nutrient_id") REFERENCES "nutrient_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "barcodes" ADD CONSTRAINT "barcodes_food_id_fkey" FOREIGN KEY ("food_id") REFERENCES "foods"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "food_portions" ADD CONSTRAINT "food_portions_food_id_fkey" FOREIGN KEY ("food_id") REFERENCES "foods"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "food_source_records" ADD CONSTRAINT "food_source_records_food_id_fkey" FOREIGN KEY ("food_id") REFERENCES "foods"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "food_source_records" ADD CONSTRAINT "food_source_records_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "data_providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "data_providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_job_rows" ADD CONSTRAINT "import_job_rows_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "import_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "food_versions" ADD CONSTRAINT "food_versions_food_id_fkey" FOREIGN KEY ("food_id") REFERENCES "foods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "release_items" ADD CONSTRAINT "release_items_release_id_fkey" FOREIGN KEY ("release_id") REFERENCES "dataset_releases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "release_items" ADD CONSTRAINT "release_items_food_version_id_fkey" FOREIGN KEY ("food_version_id") REFERENCES "food_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_ingredients" ADD CONSTRAINT "recipe_ingredients_recipe_id_fkey" FOREIGN KEY ("recipe_id") REFERENCES "recipes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meal_groups" ADD CONSTRAINT "meal_groups_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meal_group_items" ADD CONSTRAINT "meal_group_items_meal_group_id_fkey" FOREIGN KEY ("meal_group_id") REFERENCES "meal_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diary_entries" ADD CONSTRAINT "diary_entries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_shortcuts" ADD CONSTRAINT "user_shortcuts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminder_deliveries" ADD CONSTRAINT "reminder_deliveries_reminder_id_fkey" FOREIGN KEY ("reminder_id") REFERENCES "reminders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_tokens" ADD CONSTRAINT "push_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ===========================================================================
-- HAND-WRITTEN SECTION (do not regenerate; see schema.prisma header).
-- Normalization function, generated columns, partial/expression indexes,
-- check constraints, audit-log immutability.
-- ===========================================================================

-- unaccent() is STABLE, not IMMUTABLE, so it cannot appear in generated
-- columns. Pinning the dictionary makes it deterministic in practice; the
-- IMMUTABLE wrapper is the standard, documented workaround.
CREATE OR REPLACE FUNCTION immutable_unaccent(text) RETURNS text AS $$
  SELECT public.unaccent('public.unaccent'::regdictionary, $1)
$$ LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT;

-- array_to_string is STABLE for the general anyarray case; for text[] it is
-- deterministic, hence this wrapper.
CREATE OR REPLACE FUNCTION immutable_array_to_string(text[], text) RETURNS text AS $$
  SELECT array_to_string($1, $2)
$$ LANGUAGE sql IMMUTABLE PARALLEL SAFE;

-- Arabic + Latin normalization, VERSION 1. This function is the single source
-- of truth used by BOTH generated columns and query-time term normalization.
-- Changing it requires: new function name (normalize_arabic_v2), column
-- rebuild, reindex, and a dataset release rebuild. Policy:
--   alef forms/wasla (أ إ آ ٱ) -> ا ; alif maqsura (ى) -> ي ; ta marbuta (ة) -> ه
--   hamza seats (ؤ ئ) -> ء ; strip tatweel (ـ), harakat (u064B-u0652),
--   dagger alif (u0670); lower(unaccent(...)) for Latin/transliterations.
CREATE OR REPLACE FUNCTION normalize_arabic(input text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT lower(immutable_unaccent(
    regexp_replace(
      regexp_replace(
        translate(coalesce(input, ''), 'أإآٱىةؤئ', 'اااايهءء'),
        'ـ', '', 'g'),
      '[ً-ْٰ]', '', 'g')
  ));
$$;

-- ---------------------------------------------------------------------------
-- Convert norm shadow columns to GENERATED ALWAYS ... STORED
-- ---------------------------------------------------------------------------

ALTER TABLE "foods" DROP COLUMN "name_ar_norm";
ALTER TABLE "foods" DROP COLUMN "name_en_norm";
ALTER TABLE "foods"
  ADD COLUMN "name_ar_norm" TEXT GENERATED ALWAYS AS (normalize_arabic("name_ar")) STORED,
  ADD COLUMN "name_en_norm" TEXT GENERATED ALWAYS AS (normalize_arabic("name_en")) STORED;

ALTER TABLE "food_aliases" DROP COLUMN "alias_norm";
ALTER TABLE "food_aliases"
  ADD COLUMN "alias_norm" TEXT GENERATED ALWAYS AS (normalize_arabic("alias")) STORED;

ALTER TABLE "brands" DROP COLUMN "name_norm";
ALTER TABLE "brands"
  ADD COLUMN "name_norm" TEXT GENERATED ALWAYS AS (normalize_arabic("name_en")) STORED;

ALTER TABLE "food_versions" DROP COLUMN "name_ar_norm";
ALTER TABLE "food_versions" DROP COLUMN "name_en_norm";
ALTER TABLE "food_versions" DROP COLUMN "brand_name_norm";
ALTER TABLE "food_versions" DROP COLUMN "search_tsv";
ALTER TABLE "food_versions"
  ADD COLUMN "name_ar_norm" TEXT GENERATED ALWAYS AS (normalize_arabic("name_ar")) STORED,
  ADD COLUMN "name_en_norm" TEXT GENERATED ALWAYS AS (normalize_arabic("name_en")) STORED,
  ADD COLUMN "brand_name_norm" TEXT GENERATED ALWAYS AS (normalize_arabic(coalesce("brand_name", ''))) STORED,
  ADD COLUMN "search_tsv" tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', normalize_arabic("name_ar")), 'A') ||
    setweight(to_tsvector('simple', normalize_arabic("name_en")), 'A') ||
    setweight(to_tsvector('simple', coalesce(immutable_array_to_string("aliases_norm", ' '), '')), 'B') ||
    setweight(to_tsvector('simple', normalize_arabic(coalesce("brand_name", ''))), 'C')
  ) STORED;

-- ---------------------------------------------------------------------------
-- Partial / expression unique indexes
-- ---------------------------------------------------------------------------

-- Soft-deleted users free their email for re-registration (email is citext).
CREATE UNIQUE INDEX "users_email_active_uq" ON "users" ("email") WHERE "deleted_at" IS NULL;

-- One active food per barcode globally; reject/archive flips is_active.
CREATE UNIQUE INDEX "barcodes_code_active_uq" ON "barcodes" ("code") WHERE "is_active";

-- Exactly one active dataset release.
CREATE UNIQUE INDEX "dataset_releases_one_active_uq" ON "dataset_releases" ("is_active") WHERE "is_active";

-- One active calculation policy per equation key.
CREATE UNIQUE INDEX "calculation_policies_one_active_uq" ON "calculation_policies" ("key") WHERE "is_active";

-- Alias dedupe on the generated normalized form.
CREATE UNIQUE INDEX "food_aliases_food_norm_kind_uq" ON "food_aliases" ("food_id", "alias_norm", "kind");

-- ---------------------------------------------------------------------------
-- Search indexes — editorial layer (foods / aliases; reviewers search drafts)
-- ---------------------------------------------------------------------------

CREATE INDEX "foods_name_ar_trgm" ON "foods" USING gin ("name_ar_norm" gin_trgm_ops);
CREATE INDEX "foods_name_en_trgm" ON "foods" USING gin ("name_en_norm" gin_trgm_ops);
CREATE INDEX "food_aliases_norm_trgm" ON "food_aliases" USING gin ("alias_norm" gin_trgm_ops);
CREATE INDEX "foods_name_ar_norm_btree" ON "foods" ("name_ar_norm" text_pattern_ops);
CREATE INDEX "foods_name_en_norm_btree" ON "foods" ("name_en_norm" text_pattern_ops);

-- ---------------------------------------------------------------------------
-- Search indexes — published layer (food_versions), all partial on the
-- active-release flag so they track exactly the publicly served set
-- ---------------------------------------------------------------------------

CREATE INDEX "fv_name_ar_norm_btree" ON "food_versions" ("name_ar_norm" text_pattern_ops) WHERE "is_in_active_release";
CREATE INDEX "fv_name_en_norm_btree" ON "food_versions" ("name_en_norm" text_pattern_ops) WHERE "is_in_active_release";
CREATE INDEX "fv_search_tsv_gin" ON "food_versions" USING gin ("search_tsv") WHERE "is_in_active_release";
CREATE INDEX "fv_name_ar_trgm" ON "food_versions" USING gin ("name_ar_norm" gin_trgm_ops) WHERE "is_in_active_release";
CREATE INDEX "fv_name_en_trgm" ON "food_versions" USING gin ("name_en_norm" gin_trgm_ops) WHERE "is_in_active_release";
CREATE INDEX "fv_aliases_trgm" ON "food_versions" USING gin ((immutable_array_to_string("aliases_norm", ' ')) gin_trgm_ops) WHERE "is_in_active_release";
CREATE INDEX "fv_barcodes_gin" ON "food_versions" USING gin ("barcodes") WHERE "is_in_active_release";
CREATE INDEX "fv_filters" ON "food_versions" ("food_type", "category_slug", "preparation_state") WHERE "is_in_active_release";
CREATE INDEX "fv_active_slug" ON "food_versions" ("slug") WHERE "is_in_active_release";

-- ---------------------------------------------------------------------------
-- Check constraints — quantities and nutrient values
-- ---------------------------------------------------------------------------

ALTER TABLE "food_nutrients" ADD CONSTRAINT "food_nutrients_value_nonneg_ck" CHECK ("value_per_100g" >= 0);
ALTER TABLE "food_portions" ADD CONSTRAINT "food_portions_grams_positive_ck" CHECK ("grams" > 0);
ALTER TABLE "foods" ADD CONSTRAINT "foods_confidence_range_ck" CHECK ("data_confidence" >= 0 AND "data_confidence" <= 1);
ALTER TABLE "foods" ADD CONSTRAINT "foods_edible_fraction_ck" CHECK ("edible_fraction" IS NULL OR ("edible_fraction" > 0 AND "edible_fraction" <= 1));
ALTER TABLE "foods" ADD CONSTRAINT "foods_density_positive_ck" CHECK ("density_g_per_ml" IS NULL OR "density_g_per_ml" > 0);
ALTER TABLE "weight_entries" ADD CONSTRAINT "weight_entries_positive_ck" CHECK ("weight_kg" > 0 AND "weight_kg" < 500);
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_height_ck" CHECK ("height_cm" IS NULL OR ("height_cm" >= 50 AND "height_cm" <= 280));
ALTER TABLE "diary_entries" ADD CONSTRAINT "diary_entries_quantity_positive_ck" CHECK ("quantity" > 0);
ALTER TABLE "diary_entries" ADD CONSTRAINT "diary_entries_grams_positive_ck" CHECK ("grams" IS NULL OR "grams" > 0);
ALTER TABLE "recipe_ingredients" ADD CONSTRAINT "recipe_ingredients_grams_positive_ck" CHECK ("grams" > 0);
ALTER TABLE "recipe_ingredients" ADD CONSTRAINT "recipe_ingredients_quantity_positive_ck" CHECK ("quantity" > 0);
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_servings_positive_ck" CHECK ("servings" > 0);
ALTER TABLE "meal_group_items" ADD CONSTRAINT "meal_group_items_quantity_positive_ck" CHECK ("quantity" > 0);
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_time_local_format_ck" CHECK ("time_local" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');

-- ---------------------------------------------------------------------------
-- Audit log immutability — trigger-based so it holds for every role,
-- including the table owner running migrations.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION audit_log_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only';
END;
$$;

CREATE TRIGGER audit_log_no_update_delete
  BEFORE UPDATE OR DELETE ON "audit_log"
  FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();
