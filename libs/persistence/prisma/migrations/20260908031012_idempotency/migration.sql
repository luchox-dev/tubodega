-- CreateEnum
CREATE TYPE "idem_status_enum" AS ENUM ('IN_FLIGHT', 'COMPLETED');

-- CreateTable
CREATE TABLE "idempotency_key" (
    "org_id" UUID NOT NULL,
    "key" VARCHAR(128) NOT NULL,
    "request_hash" VARCHAR(64) NOT NULL,
    "status" "idem_status_enum" NOT NULL,
    "response_code" INTEGER,
    "response_body" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "idempotency_key_pkey" PRIMARY KEY ("org_id","key")
);

-- CreateIndex
CREATE INDEX "idempotency_key_expires_at_idx" ON "idempotency_key"("expires_at");

-- ═══════════════════════════════════════════════════════════════════════════
-- Hand-written part. What schema.prisma cannot express (docs/specs/04 §5.1).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Row Level Security: idempotency_key carries org_id like every other
-- business table, and the reservation runs on the tenant pool (decision D-9),
-- so without a policy one organization could probe another's keys.
ALTER TABLE "idempotency_key" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "idempotency_key" FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON "idempotency_key"
  USING      (org_id = current_setting('app.current_org')::uuid)
  WITH CHECK (org_id = current_setting('app.current_org')::uuid);

-- No GRANT needed: the ALTER DEFAULT PRIVILEGES of 0001 already gives
-- tubodega_app and tubodega_system DML on every table created afterwards.
