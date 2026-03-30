# Decision Log

This is the short version of the choices I do not want to keep re-deciding while building.

- Fresh repo initialized as `staaash`; previous implementation preserved as `staaash-old`
- Local disk only in v1
- PostgreSQL metadata plus app-managed file storage
- Immutable ID-based storage layout
- No resumable or chunked upload protocol in v1
- 10 GB practical per-file target with 60 minute timeout budget
- Public links only in v1
- Owner/member role model
- Owner cannot browse member private content through the normal app
- Search is filename/path only with normalization and deterministic ranking
- Admin health is a first-class surface
