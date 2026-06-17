# User Storage ID Migration

This migration removes usernames from account records and moves user storage from
`files/<username>` / `.trash/<username>` to `files/<storageId>` /
`.trash/<storageId>`. The new `storageId` is the sanitized first part of the
user email address, such as `johndoe` for `johndoe@example.com`; duplicate local
parts receive a short suffix.

Run it while Staaash and the worker are stopped. The database migration keeps a
temporary `_UserStorageMigration` map so the disk move can happen after
`prisma migrate deploy`.

## Docker Compose

1. Back up the database and files volume.

2. Stop app writers.

```sh
docker compose stop staaash worker
```

3. Keep Postgres running.

```sh
docker compose up -d db
```

4. Apply database migrations, then dry-run the storage move.

```sh
docker compose run --rm --no-deps staaash sh -c "prisma migrate deploy && node scripts/migrate-user-storage-ids.mjs --dry-run"
```

5. If the dry run looks right, apply it.

```sh
docker compose run --rm --no-deps staaash sh -c "node scripts/migrate-user-storage-ids.mjs --apply"
```

6. Start Staaash again.

```sh
docker compose up -d
```

The script is idempotent. It refuses to overwrite existing files and reports
each moved root plus rewritten `File.storageKey` count.
