# Readiness and operational health

`GET /api/health/ready` answers whether the web instance may receive traffic.
Its `ok`, `checks` and `failures` fields describe readiness; HTTP status is 200
when ready and 503 otherwise. Database, writable storage, settings, storage
protocol/recovery and reconciliation checks retain their existing gates. A stale
worker heartbeat still blocks readiness.

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
