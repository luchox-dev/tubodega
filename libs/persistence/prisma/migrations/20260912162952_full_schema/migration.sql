-- The new foreign keys towards app_user make Postgres validate them with a
-- query against a table that already has FORCE ROW LEVEL SECURITY from the
-- tenancy migration, and the migrator is no exception to a forced policy. With
-- app.current_org unset, current_setting() raises 42704 and the migration dies
-- before creating anything. Both sides are empty here, so any value lets the
-- validation scan run and prove what it has to prove: nothing to violate.
SET app.current_org = '00000000-0000-0000-0000-000000000000';

-- CreateEnum
CREATE TYPE "tracking_mode_enum" AS ENUM ('QUANTITY', 'LOT', 'SERIAL');

-- CreateEnum
CREATE TYPE "code_kind_enum" AS ENUM ('EAN', 'UPC', 'INTERNAL_QR', 'SUPPLIER_REF', 'OTHER');

-- CreateEnum
CREATE TYPE "custom_entity_enum" AS ENUM ('PRODUCT', 'NODE', 'BATCH');

-- CreateEnum
CREATE TYPE "custom_type_enum" AS ENUM ('TEXT', 'NUMBER', 'DATE', 'BOOLEAN', 'SELECT');

-- CreateEnum
CREATE TYPE "node_kind_enum" AS ENUM ('INTERNAL', 'CUSTODY', 'TERMINAL', 'SOURCE');

-- CreateEnum
CREATE TYPE "process_state_enum" AS ENUM ('OPEN', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "alert_kind_enum" AS ENUM ('BATCH_EXPIRING', 'BATCH_EXPIRED', 'CUSTODY_DUE', 'CUSTODY_OVERDUE');

-- CreateTable
CREATE TABLE "product" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "sku" VARCHAR(64) NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "tracking_mode" "tracking_mode_enum" NOT NULL,
    "uom" VARCHAR(16) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "custom_fields" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_code" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "value" VARCHAR(128) NOT NULL,
    "kind" "code_kind_enum" NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_code_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_media" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "storage_key" TEXT NOT NULL,
    "content_type" VARCHAR(64) NOT NULL,
    "byte_size" BIGINT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media_upload" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "storage_key" TEXT NOT NULL,
    "content_type" VARCHAR(64) NOT NULL,
    "byte_size" BIGINT NOT NULL,
    "uploaded_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimed_at" TIMESTAMPTZ,

    CONSTRAINT "media_upload_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "batch" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "lot_code" VARCHAR(64),
    "serial" VARCHAR(128),
    "expires_at" TIMESTAMPTZ,
    "custom_fields" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "batch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "custom_field_definition" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "entity" "custom_entity_enum" NOT NULL,
    "key" VARCHAR(64) NOT NULL,
    "label" TEXT NOT NULL,
    "type" "custom_type_enum" NOT NULL,
    "options" JSONB,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "custom_field_definition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "node" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "kind" "node_kind_enum" NOT NULL,
    "code" VARCHAR(64) NOT NULL,
    "name" TEXT NOT NULL,
    "parent_id" UUID,
    "path" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "custom_fields" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "node_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "movement" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "batch_id" UUID,
    "from_node_id" UUID NOT NULL,
    "to_node_id" UUID NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,
    "occurred_at" TIMESTAMPTZ NOT NULL,
    "recorded_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor_id" UUID NOT NULL,
    "reason" TEXT,
    "due_at" TIMESTAMPTZ,
    "reverses_id" UUID,
    "settles_id" UUID,
    "process_instance_id" UUID,
    "trace_id" UUID NOT NULL,
    "tracking_mode" "tracking_mode_enum" NOT NULL,
    "from_node_kind" "node_kind_enum" NOT NULL,
    "to_node_kind" "node_kind_enum" NOT NULL,

    CONSTRAINT "movement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_balance" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "node_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "batch_id" UUID,
    "node_kind" "node_kind_enum" NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_balance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "process_template" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "code" VARCHAR(64) NOT NULL,
    "version" INTEGER NOT NULL,
    "steps" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "process_template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "process_instance" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "template_code" VARCHAR(64) NOT NULL,
    "template_version" INTEGER NOT NULL,
    "state" "process_state_enum" NOT NULL,
    "current_step_id" VARCHAR(64),
    "context" JSONB NOT NULL DEFAULT '{}',
    "actor_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "process_instance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "step_completion" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "instance_id" UUID NOT NULL,
    "step_id" VARCHAR(64) NOT NULL,
    "actor_id" UUID NOT NULL,
    "payload" JSONB NOT NULL,
    "completed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "step_completion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alert" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "kind" "alert_kind_enum" NOT NULL,
    "subject_type" VARCHAR(32) NOT NULL,
    "subject_id" UUID NOT NULL,
    "due_at" TIMESTAMPTZ NOT NULL,
    "raised_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ,

    CONSTRAINT "alert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alert_rule" (
    "org_id" UUID NOT NULL,
    "kind" "alert_kind_enum" NOT NULL,
    "threshold_days" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alert_rule_pkey" PRIMARY KEY ("org_id","kind")
);

-- CreateIndex
CREATE INDEX "product_org_id_active_name_idx" ON "product"("org_id", "active", "name");

-- CreateIndex
CREATE INDEX "product_custom_fields_idx" ON "product" USING GIN ("custom_fields" jsonb_ops);

-- CreateIndex
CREATE UNIQUE INDEX "product_org_id_sku_key" ON "product"("org_id", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "product_org_id_id_key" ON "product"("org_id", "id");

-- CreateIndex
CREATE INDEX "product_code_org_id_product_id_idx" ON "product_code"("org_id", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_code_org_id_value_key" ON "product_code"("org_id", "value");

-- CreateIndex
CREATE UNIQUE INDEX "product_code_org_id_id_key" ON "product_code"("org_id", "id");

-- CreateIndex
CREATE INDEX "product_media_org_id_product_id_idx" ON "product_media"("org_id", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_media_org_id_id_key" ON "product_media"("org_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "media_upload_storage_key_key" ON "media_upload"("storage_key");

-- CreateIndex
CREATE INDEX "media_upload_created_at_idx" ON "media_upload"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "media_upload_org_id_id_key" ON "media_upload"("org_id", "id");

-- CreateIndex
CREATE INDEX "batch_org_id_expires_at_idx" ON "batch"("org_id", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "batch_org_id_product_id_lot_code_key" ON "batch"("org_id", "product_id", "lot_code");

-- CreateIndex
CREATE UNIQUE INDEX "batch_org_id_serial_key" ON "batch"("org_id", "serial");

-- CreateIndex
CREATE UNIQUE INDEX "batch_org_id_id_key" ON "batch"("org_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "custom_field_definition_org_id_entity_key_key" ON "custom_field_definition"("org_id", "entity", "key");

-- CreateIndex
CREATE UNIQUE INDEX "custom_field_definition_org_id_id_key" ON "custom_field_definition"("org_id", "id");

-- CreateIndex
CREATE INDEX "node_org_id_path_idx" ON "node"("org_id", "path" text_pattern_ops);

-- CreateIndex
CREATE INDEX "node_org_id_kind_idx" ON "node"("org_id", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "node_org_id_code_key" ON "node"("org_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "node_org_id_id_key" ON "node"("org_id", "id");

-- CreateIndex
CREATE INDEX "movement_org_id_occurred_at_idx" ON "movement"("org_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "movement_org_id_product_id_occurred_at_idx" ON "movement"("org_id", "product_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "movement_org_id_from_node_id_occurred_at_idx" ON "movement"("org_id", "from_node_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "movement_org_id_to_node_id_occurred_at_idx" ON "movement"("org_id", "to_node_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "movement_org_id_to_node_id_due_at_idx" ON "movement"("org_id", "to_node_id", "due_at");

-- CreateIndex
CREATE INDEX "movement_org_id_settles_id_idx" ON "movement"("org_id", "settles_id");

-- CreateIndex
CREATE UNIQUE INDEX "movement_org_id_reverses_id_key" ON "movement"("org_id", "reverses_id");

-- CreateIndex
CREATE UNIQUE INDEX "movement_org_id_id_key" ON "movement"("org_id", "id");

-- CreateIndex
CREATE INDEX "stock_balance_org_id_product_id_idx" ON "stock_balance"("org_id", "product_id");

-- CreateIndex
CREATE INDEX "stock_balance_org_id_node_id_idx" ON "stock_balance"("org_id", "node_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_balance_org_id_node_id_product_id_batch_id_key" ON "stock_balance"("org_id", "node_id", "product_id", "batch_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_balance_org_id_id_key" ON "stock_balance"("org_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "process_template_org_id_code_version_key" ON "process_template"("org_id", "code", "version");

-- CreateIndex
CREATE UNIQUE INDEX "process_template_org_id_id_key" ON "process_template"("org_id", "id");

-- CreateIndex
CREATE INDEX "process_instance_org_id_state_idx" ON "process_instance"("org_id", "state");

-- CreateIndex
CREATE UNIQUE INDEX "process_instance_org_id_id_key" ON "process_instance"("org_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "step_completion_org_id_instance_id_step_id_key" ON "step_completion"("org_id", "instance_id", "step_id");

-- CreateIndex
CREATE UNIQUE INDEX "step_completion_org_id_id_key" ON "step_completion"("org_id", "id");

-- CreateIndex
CREATE INDEX "alert_org_id_due_at_idx" ON "alert"("org_id", "due_at");

-- CreateIndex
CREATE UNIQUE INDEX "alert_org_id_kind_subject_type_subject_id_key" ON "alert"("org_id", "kind", "subject_type", "subject_id");

-- CreateIndex
CREATE UNIQUE INDEX "alert_org_id_id_key" ON "alert"("org_id", "id");

-- AddForeignKey
ALTER TABLE "product_code" ADD CONSTRAINT "product_code_org_id_product_id_fkey" FOREIGN KEY ("org_id", "product_id") REFERENCES "product"("org_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_media" ADD CONSTRAINT "product_media_org_id_product_id_fkey" FOREIGN KEY ("org_id", "product_id") REFERENCES "product"("org_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_upload" ADD CONSTRAINT "media_upload_org_id_uploaded_by_fkey" FOREIGN KEY ("org_id", "uploaded_by") REFERENCES "app_user"("org_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch" ADD CONSTRAINT "batch_org_id_product_id_fkey" FOREIGN KEY ("org_id", "product_id") REFERENCES "product"("org_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "node" ADD CONSTRAINT "node_org_id_parent_id_fkey" FOREIGN KEY ("org_id", "parent_id") REFERENCES "node"("org_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movement" ADD CONSTRAINT "movement_org_id_product_id_fkey" FOREIGN KEY ("org_id", "product_id") REFERENCES "product"("org_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movement" ADD CONSTRAINT "movement_org_id_batch_id_fkey" FOREIGN KEY ("org_id", "batch_id") REFERENCES "batch"("org_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movement" ADD CONSTRAINT "movement_org_id_from_node_id_fkey" FOREIGN KEY ("org_id", "from_node_id") REFERENCES "node"("org_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movement" ADD CONSTRAINT "movement_org_id_to_node_id_fkey" FOREIGN KEY ("org_id", "to_node_id") REFERENCES "node"("org_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movement" ADD CONSTRAINT "movement_org_id_actor_id_fkey" FOREIGN KEY ("org_id", "actor_id") REFERENCES "app_user"("org_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movement" ADD CONSTRAINT "movement_org_id_reverses_id_fkey" FOREIGN KEY ("org_id", "reverses_id") REFERENCES "movement"("org_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movement" ADD CONSTRAINT "movement_org_id_settles_id_fkey" FOREIGN KEY ("org_id", "settles_id") REFERENCES "movement"("org_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_balance" ADD CONSTRAINT "stock_balance_org_id_node_id_fkey" FOREIGN KEY ("org_id", "node_id") REFERENCES "node"("org_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_balance" ADD CONSTRAINT "stock_balance_org_id_product_id_fkey" FOREIGN KEY ("org_id", "product_id") REFERENCES "product"("org_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "process_instance" ADD CONSTRAINT "process_instance_org_id_template_code_template_version_fkey" FOREIGN KEY ("org_id", "template_code", "template_version") REFERENCES "process_template"("org_id", "code", "version") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "process_instance" ADD CONSTRAINT "process_instance_org_id_actor_id_fkey" FOREIGN KEY ("org_id", "actor_id") REFERENCES "app_user"("org_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "step_completion" ADD CONSTRAINT "step_completion_org_id_instance_id_fkey" FOREIGN KEY ("org_id", "instance_id") REFERENCES "process_instance"("org_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ═══════════════════════════════════════════════════════════════════════════
-- Hand-written part. What schema.prisma cannot express (docs/specs/04 §5.1).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── CHECK constraints. A Postgres CHECK cannot read another table, which is
-- why movement carries tracking_mode, from_node_kind and to_node_kind
-- denormalised: these seven are too important to leave to application code.
ALTER TABLE "movement"
  ADD CONSTRAINT "movement_i1_distinct_nodes"    CHECK (from_node_id <> to_node_id),
  ADD CONSTRAINT "movement_i2_positive_quantity" CHECK (quantity > 0),
  ADD CONSTRAINT "movement_i8_batch_iff_tracked" CHECK ((tracking_mode = 'QUANTITY') = (batch_id IS NULL)),
  ADD CONSTRAINT "movement_i11_due_only_custody" CHECK (due_at IS NULL OR to_node_kind = 'CUSTODY'),
  ADD CONSTRAINT "movement_i14_not_from_future"  CHECK (occurred_at <= recorded_at + interval '5 minutes'),
  ADD CONSTRAINT "movement_i17_custody_exit"     CHECK (from_node_kind <> 'CUSTODY'
                                                        OR settles_id IS NOT NULL
                                                        OR reverses_id IS NOT NULL),
  ADD CONSTRAINT "movement_i17_settles_custody"  CHECK (settles_id IS NULL OR from_node_kind = 'CUSTODY');

-- I-4: only the boundary of the system may go negative. Inside the warehouse,
-- dispatching what does not exist is stopped by the database, not by a prior
-- validation, so no new code path can skip it.
ALTER TABLE "stock_balance"
  ADD CONSTRAINT "stock_balance_i4_non_negative" CHECK (quantity >= 0 OR node_kind IN ('SOURCE', 'TERMINAL'));

-- I-10: the hierarchy is a tree of INTERNAL nodes. The absence of cycles needs
-- recursion and is enforced by the domain instead (spec 04 §3.3).
ALTER TABLE "node"
  ADD CONSTRAINT "node_i10_parent_is_internal" CHECK (parent_id IS NULL OR kind = 'INTERNAL');

-- C-3: a batch is a lot or a serial, never neither.
ALTER TABLE "batch"
  ADD CONSTRAINT "batch_c3_lot_or_serial" CHECK (lot_code IS NOT NULL OR serial IS NOT NULL);

ALTER TABLE "alert_rule"
  ADD CONSTRAINT "alert_rule_threshold_non_negative" CHECK (threshold_days >= 0);

-- ── Partial indexes and uniques (declared in schema.prisma too, without their
-- predicate, so Prisma leaves them alone).
DROP INDEX "media_upload_created_at_idx";
CREATE INDEX "media_upload_created_at_idx" ON "media_upload" ("created_at")
  WHERE "claimed_at" IS NULL;                       -- 24 h purge

DROP INDEX "batch_org_id_expires_at_idx";
CREATE INDEX "batch_org_id_expires_at_idx" ON "batch" ("org_id", "expires_at")
  WHERE "expires_at" IS NOT NULL;                   -- alert sweep

DROP INDEX "batch_org_id_product_id_lot_code_key";
CREATE UNIQUE INDEX "batch_org_id_product_id_lot_code_key" ON "batch" ("org_id", "product_id", "lot_code")
  WHERE "lot_code" IS NOT NULL;                     -- C-6

DROP INDEX "batch_org_id_serial_key";
CREATE UNIQUE INDEX "batch_org_id_serial_key" ON "batch" ("org_id", "serial")
  WHERE "serial" IS NOT NULL;                       -- C-5

DROP INDEX "node_org_id_kind_idx";
CREATE INDEX "node_org_id_kind_idx" ON "node" ("org_id", "kind")
  WHERE "active";

DROP INDEX "movement_org_id_reverses_id_key";
CREATE UNIQUE INDEX "movement_org_id_reverses_id_key" ON "movement" ("org_id", "reverses_id")
  WHERE "reverses_id" IS NOT NULL;                  -- I-13: one compensation per movement

DROP INDEX "movement_org_id_to_node_id_due_at_idx";
CREATE INDEX "movement_org_id_to_node_id_due_at_idx" ON "movement" ("org_id", "to_node_id", "due_at")
  WHERE "due_at" IS NOT NULL;

DROP INDEX "movement_org_id_settles_id_idx";
CREATE INDEX "movement_org_id_settles_id_idx" ON "movement" ("org_id", "settles_id")
  WHERE "settles_id" IS NOT NULL;

DROP INDEX "stock_balance_org_id_product_id_idx";
CREATE INDEX "stock_balance_org_id_product_id_idx" ON "stock_balance" ("org_id", "product_id")
  WHERE "quantity" <> 0;

DROP INDEX "stock_balance_org_id_node_id_idx";
CREATE INDEX "stock_balance_org_id_node_id_idx" ON "stock_balance" ("org_id", "node_id")
  WHERE "quantity" <> 0;

DROP INDEX "alert_org_id_due_at_idx";
CREATE INDEX "alert_org_id_due_at_idx" ON "alert" ("org_id", "due_at")
  WHERE "resolved_at" IS NULL;

-- A-1, partial on the open ones and not total: resolved alerts are kept for 90
-- days, and with a total index a batch whose stock came back could never raise
-- its alert again — ON CONFLICT DO NOTHING would swallow it (spec 04 §3.7).
DROP INDEX "alert_org_id_kind_subject_type_subject_id_key";
CREATE UNIQUE INDEX "alert_org_id_kind_subject_type_subject_id_key"
  ON "alert" ("org_id", "kind", "subject_type", "subject_id")
  WHERE "resolved_at" IS NULL;

-- ── The natural key of a balance. batch_id is NULL for QUANTITY products, and
-- by default two NULLs do not collide in a unique index: without NULLS NOT
-- DISTINCT the most common products in any catalogue get duplicate rows.
DROP INDEX "stock_balance_org_id_node_id_product_id_batch_id_key";
CREATE UNIQUE INDEX "stock_balance_org_id_node_id_product_id_batch_id_key"
  ON "stock_balance" ("org_id", "node_id", "product_id", "batch_id") NULLS NOT DISTINCT;

-- ── Row Level Security on every new table with org_id [04 §4]. FORCE makes the
-- policy apply to the table owner too; without it RLS protects nothing when the
-- application connects with a privileged role. Total after this migration: 19.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'product', 'product_code', 'product_media', 'media_upload', 'batch',
    'custom_field_definition', 'node', 'movement', 'stock_balance',
    'process_template', 'process_instance', 'step_completion', 'alert', 'alert_rule'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      $p$CREATE POLICY org_isolation ON %I
           USING      (org_id = current_setting('app.current_org')::uuid)
           WITH CHECK (org_id = current_setting('app.current_org')::uuid)$p$,
      t);
  END LOOP;
END
$$;

-- No GRANT needed: the ALTER DEFAULT PRIVILEGES of the tenancy migration
-- already gives tubodega_app and tubodega_system DML on every table created
-- afterwards.

-- ── I-3, the layer that matters: an accidental UPDATE of history becomes a
-- loud permission error instead of silent corruption. It applies to BOTH
-- application roles — immutability has no exception context [04 §4].
REVOKE UPDATE, DELETE ON "movement" FROM tubodega_app, tubodega_system;
