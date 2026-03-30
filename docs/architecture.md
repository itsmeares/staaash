# Architecture

## Summary

Staaash is a modular monolith with a separate worker runtime for background behavior.

Metadata lives in PostgreSQL. File binaries live on an app-managed local volume using immutable IDs. Logical folder paths stay in metadata only.

This is the shape I wanted from the start: simple to reason about, explicit about storage behavior, and small enough to evolve without pretending it needs microservices.

## Locked implementation behavior

- physical storage uses immutable IDs, not logical paths
- uploads stage under `FILES_ROOT/tmp/` before checksum verification and commit
- share links bind to files or folders by stable IDs
- search is case-insensitive, accent-insensitive, and path-token aware
- `/admin` health includes DB reachability, storage writability, worker heartbeat, queue backlog, disk warnings, and version/update status
- restore requires reconciliation instead of silent best effort
