-- The second layer of the append-only promise for `step_completion`, and the
-- index the instance listing orders by.
--
-- Neither is visible to `prisma migrate diff`, for opposite reasons: the REVOKE
-- because privileges are not introspected at all — same as the `text_pattern_ops`
-- of decision D-1 — and the index because it *is* introspected, which is why its
-- twin goes into `schema.prisma` in the same commit. `pnpm db:check` stays at 0.

-- Decision D-49. Promised three times in prose — spec 13 §2, §8 and the header
-- of `abstract-append.dao.ts`, which says "the REVOKE is the second" — and
-- until now nowhere in SQL: `full_schema` only revokes over `movement`. The DAO
-- type is the first layer; a role that physically cannot UPDATE is the second,
-- and it is the one that survives somebody reaching for raw SQL.
REVOKE UPDATE, DELETE ON "step_completion" FROM tubodega_app, tubodega_system;

-- Decision D-62. `GET /v1/process-instances` sorts only by `created_at`, newest
-- first, and this is what backs it.
CREATE INDEX "process_instance_org_id_created_at_idx" ON "process_instance"("org_id", "created_at" DESC);
