# API

`apps/web/openapi.json` describes every public route. Within a major version,
the API only gains routes and fields: nothing is renamed or removed, and an
older client keeps working. `GET /api/version` reports the server version and
the oldest desktop client it supports.

## Signing in

Browsers use the session cookie. A request that changes something must come
from the same address it was sent to: the server compares the `Origin` host
with the `Host` header. The desktop app signs in through the browser and sends
its device token as `Authorization: Bearer <token>`. Device tokens cannot use
admin routes.

## Large folder changes

A folder change sent with `Prefer: respond-async` whose tree holds more than
2,000 items answers `202` with a `FolderOperation`. Poll
`GET /api/files/folders/operations/{id}` until it reports `succeeded`,
`failed` or `recovery_required`. Without the header, or for a smaller tree,
the change runs in the request and answers `200`. How the journal applies
these changes is in [storage recovery](storage-recovery.md#large-folder-changes).

## Health checks

`GET /api/health/live` answers `200` while the web process runs. The Docker
health check uses it.

`GET /api/health/ready` answers whether the web instance may receive traffic.
Its `ok`, `checks` and `failures` fields describe readiness; HTTP status is 200
when ready and 503 otherwise. The database, writable storage, settings, storage
recovery and reconciliation checks each block readiness, and so does a stale
worker heartbeat.

Failed, dead or stale background jobs are operational incidents, not proof that
this web instance cannot serve files. A corrupt video's failed preview therefore
does not remove file access from traffic. This applies to historical failures of
maintenance jobs too: a current storage recovery requirement still blocks
readiness, while a historical failed job remains visible for investigation.
Unknown job kinds follow the same observation-based policy.

Queue query availability is checked separately. An unsuccessful queue probe is
unknown, returns `checks.queue: "error"` and adds `QUEUE_PROBE_UNAVAILABLE` to
readiness failures. Successful queue observation reports `checks.queue:
"healthy"`, even when its recorded jobs need attention.

The response adds an `operational` object with `status` and incident codes:
`DEAD_JOBS`, `FAILED_JOBS`, `STALE_JOBS`, `WORKER_WARNING`,
`RECONCILIATION_WARNING` and `STORAGE_WARNING`, as applicable. Readiness failures
also appear there. Operational status is `error` when readiness is blocked,
`warning` when nonblocking incidents exist, and `healthy` otherwise. The public
endpoint exposes no job IDs, paths, database errors or account details.

Admin Overview displays **Serving traffic** separately from **Operational
health**, alongside the queue counts and a link to jobs. The authenticated admin
health endpoint retains full queue diagnostics, including its original job
severity and the new `queue.probeStatus`. Alert on operational incidents
independently of the routing probe. Do not cancel or delete a dead job merely to
make readiness succeed.

For example, one dead optional preview with healthy dependencies returns:

```json
{
  "ok": true,
  "checks": { "queue": "healthy" },
  "failures": [],
  "operational": { "status": "warning", "incidents": ["DEAD_JOBS"] }
}
```

This example omits the other unchanged checks. A storage mutation requiring
operator recovery instead returns 503 with `STORAGE_RECOVERY_REQUIRED`.
