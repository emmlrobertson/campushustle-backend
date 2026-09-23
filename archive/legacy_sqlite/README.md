# Legacy SQLite Archive (Pre-PostgreSQL)

This directory preserves historical prototyping and data-migration scripts from the pre-production SQLite era.

## Archived Components
- `campushustle.sqlite`: Historical snapshot database used prior to PostgreSQL migration.
- `database.ts`: Legacy SQLite driver initialization using `sqlite` and `sqlite3`.
- `initDb.ts`: Initial prototype SQLite schema creation script.
- `migrateSqliteToPostgres.ts`: One-time script that migrated legacy data to PostgreSQL.

## Production Status
- **NOT USED AT RUNTIME**.
- The production database is **PostgreSQL** accessed exclusively through **Prisma Client** via `DATABASE_URL`.
- These files are kept strictly for archival reference and historical data provenance.
