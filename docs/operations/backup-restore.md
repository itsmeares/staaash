# Backup And Restore

Staaash is still in alpha. Do not keep important files in Staaash unless you also have a separate backup.

Back up both data folders together:

- `library` - uploaded files
- `postgres` - database files

By default these folders sit next to `docker-compose.yml`. If you changed `UPLOAD_LOCATION` or `DB_DATA_LOCATION` in `.env`, back up those custom paths instead.

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

## Notes

- File names and folder paths live in the database.
- File bytes live in `library`.
- A backup that only includes one of them is incomplete.
- Preview files can be rebuilt later, but original files cannot.
