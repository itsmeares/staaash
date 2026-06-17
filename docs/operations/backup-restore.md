# Backup And Restore

Staaash is in beta. Do not keep important files in Staaash unless you also have a separate backup.

Back up both data folders together:

- `library` - uploaded files
- `postgres` - database files

By default these folders sit next to `docker-compose.yml`. If you changed `UPLOAD_LOCATION` or `DB_DATA_LOCATION` in `.env`, back up those custom paths instead.

Fresh installs use Postgres 18. The default `postgres` folder is still the folder you back up, but the Postgres 18 container stores the actual database cluster under its versioned directory inside the container.

For the username removal upgrade, also follow
[`user-storage-id-migration.md`](./user-storage-id-migration.md) after the
database migration runs.

## Backup Checklist

1. Stop writes for a moment.
   The simplest way is to stop Staaash while the backup runs:

   ```console
   docker compose stop staaash worker
   ```

2. Copy `library` and `postgres` to your backup location.

3. Start Staaash again:

   ```console
   docker compose up -d
   ```

4. Keep more than one backup copy.
   A good starting point is one local backup and one backup outside the machine.

## Restore Drill

Test restore before you need it for real.

1. Start from a clean folder with `docker-compose.yml` and `.env`.
2. Put the backed-up `library` and `postgres` folders back in place.
3. Start Staaash:

   ```console
   docker compose up -d
   ```

4. Sign in as the owner.
5. Open the admin area and run the restore reconciliation job.
6. Check the basics:
   - upload a small file
   - download an existing file
   - open a folder
   - search for a file
   - restore something from trash
   - open a public share link, if you use shares

If any check fails, keep the restored copy untouched and investigate before using it as your main copy.

## Moving Beta Data To Postgres 18

Do not reuse a Postgres 16 `postgres` folder by only changing the image tag to Postgres 18. That can leave the database unable to start.

The supported path for current beta installs is a dump and restore:

1. Update to the last Staaash build that still uses Postgres 16, then let the app start and finish its migrations.
2. Stop app writes:

   ```console
   docker compose stop staaash worker
   ```

3. Create a data-only dump without Prisma migration history:

   ```console
   docker compose exec db sh -c 'pg_dump --data-only --disable-triggers --exclude-table=_prisma_migrations -U "$POSTGRES_USER" "$POSTGRES_DB"' > staaash-data.sql
   ```

4. Back up `library` and the old `postgres` folder.
5. Move the old `postgres` folder aside. Keep it until the new install is checked.
6. Start a fresh Postgres 18 database:

   ```console
   docker compose up -d db
   ```

7. Run the new baseline migration:

   ```console
   docker compose run --rm --no-deps staaash prisma migrate deploy
   ```

8. Restore the data-only dump into the fresh database:

   ```console
   docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" "$POSTGRES_DB"' < staaash-data.sql
   ```

9. Start Staaash again:

   ```console
   docker compose up -d
   ```

10. Sign in, open the admin area, and run the restore reconciliation job.
11. Check the basics: file list, upload, download, search, trash restore, and any share links you rely on.

Older alpha or beta schemas are not upgraded directly by this baseline. Update to the latest pre-baseline release first, or reset and start fresh.

## Notes

- File names and folder paths live in the database.
- File bytes live in `library`.
- A backup that only includes one of them is incomplete.
- Preview files can be rebuilt later, but original files cannot.
