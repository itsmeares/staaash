# Backup And Restore

Staaash is in beta. Do not keep important files in Staaash unless you also have a separate backup.

Back up both data folders together:

- `library` - uploaded files
- `postgres` - database files

By default these folders sit next to `docker-compose.yml`. If you changed `UPLOAD_LOCATION` or `DB_DATA_LOCATION` in `.env`, back up those custom paths instead.

Fresh installs use Postgres 18. The default `postgres` folder is still the folder you back up, but the Postgres 18 container stores the actual database cluster under its versioned directory inside the container.

This guide applies only to compatible installations in the supported Postgres 18 RC/current release line. Alpha and beta releases are unsupported development history and cannot be upgraded to the RC or v1 line. Start a fresh current installation instead. Do not reuse an alpha/beta deployment's internal database or storage directories as the data directories for a current installation.

## Backup Checklist

1. Stop application writes, then cleanly stop PostgreSQL:

   ```console
   docker compose stop staaash worker
   docker compose stop db
   ```

2. Confirm that all three services are stopped:

   ```console
   docker compose ps --status running
   ```

   The command must show no running services. Do not begin the copy while
   `staaash`, `worker`, or `db` is running. Raw PostgreSQL data-directory copies
   must not be taken while PostgreSQL is running.

3. While all three services remain stopped, copy both configured host data
   locations into the same backup set:
   - `UPLOAD_LOCATION` (default: `./library`)
   - `DB_DATA_LOCATION` (default: `./postgres`)

   Read the paths from the deployment's `.env` file. Do not restart any service
   until both copies have finished.

4. Preserve the completed backup unchanged. Keep more than one backup copy; a
   good starting point is one local backup and one backup outside the machine.

5. Restart the complete stack:

   ```console
   docker compose up -d db staaash worker
   ```

6. Perform the restore drill below on a separate clean deployment before
   trusting the backup.

## Restore Drill

Test restore before you need it for real. Use a copy for the drill and keep the
original backup unchanged.

1. Start from a separate clean folder with matching `docker-compose.yml` and
   `.env` files. Do not start the deployment yet.
2. Confirm that this clean deployment has no running services:

   ```console
   docker compose ps --status running
   ```

3. Put both backed-up host data locations in the paths configured by
   `UPLOAD_LOCATION` and `DB_DATA_LOCATION` in the clean deployment's `.env`
   file. If those variables were not customized, restore them as `./library`
   and `./postgres`. Keep PostgreSQL stopped until both locations are in place.
4. Start the complete stack:

   ```console
   docker compose up -d db staaash worker
   ```

5. Sign in as the owner.
6. Open the admin area and run the restore reconciliation job.
7. Check the basics:
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
- A backup containing only uploaded files is incomplete.
- A backup containing only the database is incomplete.
- Raw PostgreSQL data-directory copies must not be taken while PostgreSQL is
  running.
- Preview and other derivative files can be rebuilt later, but original uploaded
  files cannot.
