-- Provisioning of the three application roles and the three databases.
-- Runs once, when the Postgres container initialises its data volume.
-- Roles are created here and never by migrations: the migrator must not
-- hold CREATEROLE (spec 04 §5.1).
CREATE ROLE tubodega_migrator LOGIN PASSWORD 'migrator';
CREATE ROLE tubodega_app      LOGIN PASSWORD 'app'    NOBYPASSRLS;
CREATE ROLE tubodega_system   LOGIN PASSWORD 'system' BYPASSRLS;

CREATE DATABASE tubodega        OWNER tubodega_migrator;
CREATE DATABASE tubodega_test   OWNER tubodega_migrator;
CREATE DATABASE tubodega_shadow OWNER tubodega_migrator;
