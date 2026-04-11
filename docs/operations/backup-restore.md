# Backup And Restore

## Backup Baseline

Crash-consistent backup is the minimum accepted baseline in v1.

That is the floor, not the ideal. The repo should behave predictably after a crash-consistent backup and restore, but stronger coordination is still better when it is available.

## Recommended Practice

Use coordinated backup when your environment supports it.

The app is explicitly designed so that metadata and file storage can be reasoned about together. Backup strategy should respect that instead of treating the database and files volume as unrelated assets.

## Required Backup Set

Back up both of these:

- PostgreSQL data
- the mounted files volume

Preview assets are derivative. They are useful, but they are not the primary recovery target and can be regenerated after restore.

## Restore Order

1. Restore PostgreSQL.
2. Restore the files volume.
3. Start the web app and worker.
4. Verify health endpoints and basic system reachability.
5. Open `/admin/integrity` as the owner and run restore reconciliation.
6. Review the latest integrity report for missing originals or orphaned storage files.
7. Verify that a known file path and download path still resolve through the app.

## Reconciliation Expectations

The reconciliation pass must:

- verify metadata-to-original-file presence
- treat preview-capable media as valid when the original file exists
- report orphaned or inconsistent items to the owner

## Caveats

- restore is not considered complete until reconciliation has run
- inline preview compatibility depends on the original file, not regenerated derivatives
- the system should report inconsistencies instead of silently guessing at repairs
