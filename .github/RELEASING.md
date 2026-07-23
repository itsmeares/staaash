# Releasing Staaash

The release workflow treats a Git tag, exact commit, package versions, validated CI run, GHCR image, OCI index digest, GitHub Release, and installation assets as one release identity.

## Prerequisites

Before creating a release tag:

1. Merge the release commit to `main`.
2. Set the same normalized version in:
   - `package.json`
   - `apps/web/package.json`
   - `apps/worker/package.json`
   - `packages/config/package.json`
   - `packages/db/package.json`
3. Wait for the `CI` workflow on that exact `main` SHA to pass. A tag created while CI is running waits for the exact run; no release state is written first.
4. Use a canonical tag: `v<major>.<minor>.<patch>` with an optional SemVer prerelease suffix. Build metadata is not supported because it cannot be represented unchanged as an OCI tag.
5. Ensure the repository ruleset for `refs/tags/v*` blocks tag updates and deletion.

Alpha and beta releases remain unsupported development history. Their prerelease classification does not restore an upgrade path. Users must start a fresh current installation and must not reuse alpha/beta internal database or storage directories.

## Automated sequence

`.github/workflows/release.yml` globally queues releases and performs:

1. Resolve the tag object and peeled commit; require the commit on current `main`.
2. Verify all package versions and a successful exact-SHA `CI` main-push run.
3. Create or verify a hidden draft GitHub Release with generated notes and managed provenance.
4. Build the exact versioned image once, or reuse a matching existing image.
5. Capture and remotely verify the top-level OCI index digest, OCI labels, and final web/worker runtime versions.
6. Generate release-specific `docker-compose.yml`, `example.env`, `release-manifest.json`, and `SHA256SUMS`.
7. Reconcile missing draft assets without overwriting mismatched assets.
8. Publish the GitHub Release after every exact artifact check passes.
9. For stable releases only, copy the verified OCI index digest to `latest` without rebuilding, verify it, then mark the same GitHub Release as latest.

Every SemVer prerelease skips both latest-channel mutations. A stable release is complete and installable through exact-tag assets before `latest` promotion starts; its verified digest remains recorded in manifest and provenance metadata.

## Recovery

Use **Actions → Release → Run workflow** with the same existing tag. Never move or recreate the tag to retry.

Matching partial state is resumed:

- Matching draft: continue.
- Matching exact image: reuse its digest; do not rebuild.
- Missing draft assets: upload only missing assets.
- Matching published release: verify and continue only a pending stable `latest` promotion.
- Matching `latest`: no-op.

Conflicting state fails closed:

- Tag object or commit changed.
- Exact image digest, labels, or runtime versions differ.
- Managed release provenance differs or is malformed.
- Required asset has a different digest.
- Published release is incomplete or mismatched.
- `latest` has the same version but another digest/revision.

Do not use asset clobbering, force-push tags, delete releases, or overwrite image tags as routine recovery. Preserve conflicting state for investigation. Any destructive cleanup needs an explicit maintainer decision after expected and actual SHA/digest values are compared.

## Failure boundaries

- Validation or draft creation failure: no image or `latest` change.
- Image build/push failure: draft remains hidden; retry inspects whether the exact tag is absent, matching, or conflicting.
- Asset failure: exact image may be pullable, but release remains a draft and `latest` cannot change.
- Publication failure: complete draft remains retryable; `latest` cannot change.
- Stable `latest` failure: exact GitHub Release remains complete, tag-selected, and digest-verified. Retry performs verification and pending promotion without rebuilding.

Each failed workflow writes retry and investigation guidance to its job summary.

## Release assets

Release-generated Compose and env files select the exact readable tag:

```text
ghcr.io/itsmeares/staaash:<tag>
```

`release-manifest.json` records tag object, commit SHA, image repository, verified OCI index digest, full immutable reference, platform, and OCI labels. `SHA256SUMS` covers Compose, env, and manifest files. The workflow validates both the normal tag selection and an optional `STAAASH_VERSION=<tag>@sha256:<digest>` override. Source files on `main` remain templates and are never uploaded directly as release assets.

## Controlled rehearsal

Before first production release using this workflow, run the full publication and recovery matrix in a disposable repository and separate GHCR package. Cover stable, RC, beta, CI failure, draft failure, image failure, partial assets, publication failure, promotion failure, matching/conflicting image, matching/conflicting release, tag movement, idempotent rerun, and prerelease-after-stable behavior.

Do not create rehearsal tags, images, or releases in `itsmeares/staaash`.
