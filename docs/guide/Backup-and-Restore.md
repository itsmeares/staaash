# Backup and Restore

Staaash is not a backup system. It is a drive. If the disk dies, or you delete the wrong folder, your files are gone unless you have a backup.

## What to back up

Two folders, always together:

- `library` holds your uploaded files.
- `postgres` holds the database. It remembers file names, folders, people and share links.

A backup with only one of them is not complete. Files without the database lose their names and folders. A database without the files has names that point to nothing.

Keep a copy of your `.env` file with them. The database only opens with the `DB_PASSWORD` it was made with, and `.env` holds that password and your other settings. Store it somewhere safe, because it is a secret.

These are the default names. If you changed `UPLOAD_LOCATION` or `DB_DATA_LOCATION` in your `.env` file, back up those folders instead.

Copy the whole `library` folder, including its hidden and temporary folders. Unfinished changes keep their safety copies there.

Preview pictures and zip files do not need special care. Staaash can rebuild them. Your original files cannot be rebuilt.

On the Windows server installer, the steps are different. See [[Windows Server]].

## Make a backup

Stop everything first, so no file changes while you copy.

1. Stop the web app:

   ```console
   docker compose stop staaash
   ```

2. Give the worker a minute to finish unfinished changes. Then check that none are left:

   ```console
   docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL'
   SELECT status, count(*) FROM "StorageMutation"
   WHERE status IN ('prepared', 'running', 'retrying', 'metadata_committed', 'finalizing')
   GROUP BY status;
   SQL
   ```

   Run it again until it prints `(0 rows)`. A change that says **Needs review** in admin **Storage** is not in this list. Leave it as it is, and read [[Storage Check]].

   On Windows with Docker Desktop, run this in WSL or Git Bash.

3. Stop the worker and the migration step:

   ```console
   docker compose stop worker migrate
   ```

   Run the check from step 2 once more, because the worker may have started a cleanup job. If it prints any rows, run `docker compose start worker` and go back to step 2.

4. Stop the database:

   ```console
   docker compose stop db
   ```

5. Check that nothing is running:

   ```console
   docker compose ps --status running
   ```

   The list must be empty. Do not copy the database folder while the database runs. The copy would be broken.

6. Copy both folders (`library` and `postgres`) and your `.env` file to your backup place. Copy them in the same session, so they match.

7. Start Staaash again:

   ```console
   docker compose up -d
   ```

Keep more than one copy. A good start is one copy on another disk in the same house, and one copy somewhere else, such as a different building or an online storage service you trust.

## Practice a restore

A backup you never tried is only a hope. Practice on a spare computer, never over your real install.

A new folder on the same computer is not enough. `docker-compose.yml` always uses the project name `staaash` and the same container names, so it would take over your real install. If you have only one computer, stop the real install first with `docker compose down` in its folder, and start it again when you are done.

1. Make a new empty folder. Copy in `docker-compose.yml` and `.env` from your real install. Do not start anything yet. If `UPLOAD_LOCATION` or `DB_DATA_LOCATION` in the copied `.env` is a full path, change it to a folder inside the new folder, so the practice copy never touches your real files.
2. Put your backed-up `library` and `postgres` folders where `UPLOAD_LOCATION` and `DB_DATA_LOCATION` point.
3. Start it with `docker compose up -d`, and sign in as the owner.
4. Open admin **Jobs** and run **Restore check**. It compares the files on disk with what the database remembers.
5. Open a folder, download an old file, upload a small one, and open a share link if you use them.

If something fails, keep the restored copy as it is and do not use it as your main copy. Ask in [GitHub Discussions](https://github.com/itsmeares/staaash/discussions).

To restore for real, do the same on the real computer with Staaash stopped, then run **Restore check**.

Backups only work with the version that made them, or a newer one. To go back to an older version, restore a backup made before you updated. See [[Updating]].
