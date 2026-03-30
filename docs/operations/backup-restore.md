# Backup and Restore

## Minimum guarantee

Crash-consistent backup is the minimum accepted backup baseline in v1.

## Recommended practice

Coordinated backup is recommended when available.

## Backup set

Back up both:

- PostgreSQL data
- the mounted files volume

Preview assets are derivative and can be regenerated after restore.

## Restore order

1. Restore PostgreSQL.
2. Restore the files volume.
3. Start the web app and worker.
4. Verify health endpoints.
5. Run restore reconciliation.
6. Verify that a known file path and download path still resolve through the app.

## Reconciliation

The reconciliation pass must:

- verify metadata-to-original-file presence
- schedule preview regeneration for missing derivatives
- report orphaned or inconsistent items to the owner
