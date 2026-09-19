-- Decision D-67, and it is a bug fix, not a tidy-up.
--
-- `now()` writes microseconds; a JavaScript `Date` only holds milliseconds. So
-- for any column paged by keyset, the cursor built from a row carries a value
-- **truncated below** the one actually stored, and `(created_at, id) < (cursor)`
-- then excludes every row of that same millisecond — the cursor silently
-- skipping rows, which is the one thing it exists to prevent.
--
-- It is not theoretical: `POST /v1/products/import` writes up to 1000 rows in a
-- single transaction, so all of them share one `now()`, and
-- `GET /v1/products?sort=createdAt&limit=50` returns an empty second page.
--
-- Three columns are reachable as cursor sort keys today — `product.created_at`
-- and `node.created_at` from their `sortable` lists, and
-- `process_instance.created_at` from D-62. Rounding them to the precision the
-- application can actually represent makes the two agree by construction.
-- `movement.occurred_at` is left alone: it is client-supplied and arrives
-- through `new Date(iso)`, which is already milliseconds.
ALTER TABLE "product" ALTER COLUMN "created_at" TYPE timestamptz(3);
ALTER TABLE "node" ALTER COLUMN "created_at" TYPE timestamptz(3);
ALTER TABLE "process_instance" ALTER COLUMN "created_at" TYPE timestamptz(3);
