-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "citext";

-- CreateEnum
CREATE TYPE "role_enum" AS ENUM ('OWNER', 'ADMIN', 'OPERATOR', 'VIEWER');

-- CreateTable
CREATE TABLE "organization" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" VARCHAR(64) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_user" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "email" CITEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "app_user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_role" (
    "user_id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "role" "role_enum" NOT NULL,

    CONSTRAINT "user_role_pkey" PRIMARY KEY ("user_id","role")
);

-- CreateTable
CREATE TABLE "refresh_token" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "revoked_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_token_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_event" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "type" VARCHAR(64) NOT NULL,
    "payload" JSONB NOT NULL,
    "trace_id" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMPTZ,

    CONSTRAINT "outbox_event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organization_slug_key" ON "organization"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "app_user_org_id_email_key" ON "app_user"("org_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "app_user_org_id_id_key" ON "app_user"("org_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_token_token_hash_key" ON "refresh_token"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_token_user_id_idx" ON "refresh_token"("user_id");

-- CreateIndex
CREATE INDEX "outbox_event_published_at_occurred_at_idx" ON "outbox_event"("published_at", "occurred_at");

-- AddForeignKey
ALTER TABLE "app_user" ADD CONSTRAINT "app_user_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_role" ADD CONSTRAINT "user_role_org_id_user_id_fkey" FOREIGN KEY ("org_id", "user_id") REFERENCES "app_user"("org_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_token" ADD CONSTRAINT "refresh_token_org_id_user_id_fkey" FOREIGN KEY ("org_id", "user_id") REFERENCES "app_user"("org_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ═══════════════════════════════════════════════════════════════════════════
-- Hand-written part. What schema.prisma cannot express (docs/specs/04 §5.1).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Partial indexes (declared in schema.prisma too, so Prisma leaves them alone)
DROP INDEX IF EXISTS "refresh_token_user_id_idx";
CREATE INDEX "refresh_token_user_id_idx" ON "refresh_token" ("user_id")
  WHERE "revoked_at" IS NULL;

DROP INDEX IF EXISTS "outbox_event_published_at_occurred_at_idx";
CREATE INDEX "outbox_event_published_at_occurred_at_idx" ON "outbox_event" ("published_at", "occurred_at")
  WHERE "published_at" IS NULL;

-- ── Row Level Security on every table with org_id (organization has none) [04 §4]
-- FORCE makes the policy apply to the table owner too; without it RLS protects
-- nothing when the app connects with a privileged role.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['app_user', 'user_role', 'refresh_token', 'outbox_event'] LOOP
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

-- ── Privileges of the two application roles [04 §4, 07 §2]
-- Tables are owned by tubodega_migrator; the app roles get DML only.
GRANT USAGE ON SCHEMA public TO tubodega_app, tubodega_system;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO tubodega_app, tubodega_system;
ALTER DEFAULT PRIVILEGES FOR ROLE tubodega_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO tubodega_app, tubodega_system;
-- The migrations table may not exist yet (shadow database); revoke only if present.
DO $$
BEGIN
  IF to_regclass('public._prisma_migrations') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON _prisma_migrations FROM tubodega_app, tubodega_system';
  END IF;
END
$$;
