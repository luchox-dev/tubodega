-- Decision D-68, and it finishes what D-67 started.
--
-- D-67 fixed three columns by naming them one by one, and the list was already
-- short the day it was written: `movement.occurred_at` is a fourth key reachable
-- as a cursor sort key, from `GET /v1/movements` and from
-- `GET /v1/stock/custodies` — the second of which keysets by hand. It was called
-- safe because every writer today goes through `new Date(iso)`. That is safety
-- by convention of the write path, not by type, and the type is what a table
-- guarantees.
--
-- So the property, not the census: **every** timestamp column goes to
-- milliseconds. It is true of the whole system and not only of cursors — a
-- JavaScript `Date` reaches the millisecond, and everything read out of Postgres
-- passes through one. A microsecond column stores something nothing in this
-- codebase can read back, which is not extra information; it is a trap set for
-- whoever next compares one of these against a `Date`. Twenty-five columns
-- beyond the four cursor keys were in exactly that position.
--
-- Postgres **rounds** when narrowing the type, it does not truncate: an already
-- stored value moves to the nearest millisecond and from then on is exactly
-- representable as a `Date`. That round trip is the whole property.
--
-- `test/schema/timestamp-precision.int-spec.ts` holds it from here on, by asking
-- `information_schema` rather than by keeping a list — which is the part that
-- makes this a fix and not another patch. `pnpm db:check` cannot see it: a new
-- table with a bare `@db.Timestamptz` in both the schema and its migration is
-- perfectly consistent, and reproduces D-67 whole.
ALTER TABLE "organization"            ALTER COLUMN "created_at"   TYPE timestamptz(3);
ALTER TABLE "organization"            ALTER COLUMN "updated_at"   TYPE timestamptz(3);
ALTER TABLE "app_user"                ALTER COLUMN "created_at"   TYPE timestamptz(3);
ALTER TABLE "app_user"                ALTER COLUMN "updated_at"   TYPE timestamptz(3);
ALTER TABLE "refresh_token"           ALTER COLUMN "expires_at"   TYPE timestamptz(3);
ALTER TABLE "refresh_token"           ALTER COLUMN "revoked_at"   TYPE timestamptz(3);
ALTER TABLE "refresh_token"           ALTER COLUMN "created_at"   TYPE timestamptz(3);
ALTER TABLE "outbox_event"            ALTER COLUMN "occurred_at"  TYPE timestamptz(3);
ALTER TABLE "outbox_event"            ALTER COLUMN "published_at" TYPE timestamptz(3);
ALTER TABLE "idempotency_key"         ALTER COLUMN "created_at"   TYPE timestamptz(3);
ALTER TABLE "idempotency_key"         ALTER COLUMN "expires_at"   TYPE timestamptz(3);
ALTER TABLE "product"                 ALTER COLUMN "updated_at"   TYPE timestamptz(3);
ALTER TABLE "product_code"            ALTER COLUMN "created_at"   TYPE timestamptz(3);
ALTER TABLE "product_media"           ALTER COLUMN "created_at"   TYPE timestamptz(3);
ALTER TABLE "media_upload"            ALTER COLUMN "created_at"   TYPE timestamptz(3);
ALTER TABLE "media_upload"            ALTER COLUMN "claimed_at"   TYPE timestamptz(3);
ALTER TABLE "batch"                   ALTER COLUMN "expires_at"   TYPE timestamptz(3);
ALTER TABLE "batch"                   ALTER COLUMN "created_at"   TYPE timestamptz(3);
ALTER TABLE "custom_field_definition" ALTER COLUMN "created_at"   TYPE timestamptz(3);
ALTER TABLE "custom_field_definition" ALTER COLUMN "updated_at"   TYPE timestamptz(3);
ALTER TABLE "node"                    ALTER COLUMN "updated_at"   TYPE timestamptz(3);
-- The fourth cursor key, and the reason this migration exists.
ALTER TABLE "movement"                ALTER COLUMN "occurred_at"  TYPE timestamptz(3);
ALTER TABLE "movement"                ALTER COLUMN "recorded_at"  TYPE timestamptz(3);
ALTER TABLE "movement"                ALTER COLUMN "due_at"       TYPE timestamptz(3);
ALTER TABLE "stock_balance"           ALTER COLUMN "updated_at"   TYPE timestamptz(3);
ALTER TABLE "process_template"        ALTER COLUMN "created_at"   TYPE timestamptz(3);
ALTER TABLE "process_instance"        ALTER COLUMN "updated_at"   TYPE timestamptz(3);
ALTER TABLE "step_completion"         ALTER COLUMN "completed_at" TYPE timestamptz(3);
ALTER TABLE "alert"                   ALTER COLUMN "due_at"       TYPE timestamptz(3);
ALTER TABLE "alert"                   ALTER COLUMN "raised_at"    TYPE timestamptz(3);
ALTER TABLE "alert"                   ALTER COLUMN "resolved_at"  TYPE timestamptz(3);
ALTER TABLE "alert_rule"              ALTER COLUMN "updated_at"   TYPE timestamptz(3);
