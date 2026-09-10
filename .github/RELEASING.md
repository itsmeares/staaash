# Releasing Staaash

The release workflow treats a Git tag, exact commit, package versions, validated CI run, GHCR image, OCI index digest, GitHub Release, and installation assets as one release identity.

Alpha and beta releases remain unsupported development history. Their prerelease classification does not restore an upgrade path. Users must start a fresh current installation and must not reuse alpha/beta internal database or storage directories.

## Start a release

Run a new release from `main` with the version input:

```text
gh workflow run release.yml --ref main -f version=v1.1.0
```

The workflow globally queues releases and performs:

1. Validate the requested version and update all package versions together.
2. Commit the version change directly to `main` with the release App.
3. Create the immutable `v<version>` tag from that exact commit.
4. Select immutable tooling and source checkouts. A new release uses tooling committed in the new tag. Manual recovery uses the exact `main` commit that defined the dispatched workflow. Release source always comes from the requested tag.
5. Resolve the tag object and peeled commit; require the commit on current `main`.
6. Verify all package versions plus successful exact-SHA `CI` main-push runs for the release commit and, when different during recovery, the tooling commit.
7. Create a hidden draft GitHub Release for a new release, or resolve the exact release ID supplied for manual recovery, then validate managed provenance.
8. Build the exact versioned image once, or reuse a matching image.
9. Capture and remotely verify the top-level OCI index digest, OCI labels, and final web/worker runtime versions.
10. Generate release-specific `docker-compose.yml`, `example.env`, `release-manifest.json`, and `SHA256SUMS`.
11. Reconcile missing draft assets without overwriting mismatched assets.
12. Publish the GitHub Release after every exact artifact check passes.
13. For stable releases only, copy the verified OCI index digest to `latest` without rebuilding, verify it, then mark the same GitHub Release as latest.

The first release using this path may therefore be `v1.1.0`; no package files need to be edited in advance.

## Release notes

GitHub-generated notes form the initial release body. After publication, update the release notes with `gh release edit` or the GitHub UI as needed. Preserve this managed block exactly, including its contents:

```text
<!-- staaash:release-provenance:start -->
...
<!-- staaash:release-provenance:end -->
```

The block records the release commit, tag object, image digest, immutable image reference, and generated asset checksums. Do not replace it with a new generated body.

Every SemVer prerelease skips both latest-channel mutations. A stable release is complete and installable through exact-tag assets before `latest` promotion starts; its verified digest remains recorded in manifest and provenance metadata.

## Recovery

Use **Actions → Release → Run workflow** from `main` with the existing tag and exact existing GitHub Release ID, leaving `version` empty. Never dispatch recovery from another branch, and never move or recreate the tag to retry.

```text
gh workflow run release.yml --ref main -f tag=v1.1.0 -f release_id=123
```

GitHub may expose a draft release through an `untagged-<20 lowercase hex>` placeholder and report `target_commitish` as `main`, including when the real tag already exists. Those draft fields are not release identity. Recovery binds to the explicit numeric release ID, prerelease state, and managed provenance containing the expected tag, peeled commit, and annotated tag object. Publication explicitly binds the existing tag with `tag_name` while omitting `target_commitish`, then validates the real tag through the exact release ID. A retry also repairs the narrow intermediate state where publication succeeded but GitHub still exposes the placeholder tag.

Manual recovery records the exact `main` commit selected by GitHub as the recovery-tooling SHA and requires a successful exact-SHA `CI` main-push run for it. The orchestrator and compiled release policy run from that immutable tooling checkout. Package versions, Git identity, templates, Docker build context, generated assets, image labels, and release provenance remain sourced from the separate immutable release-tag checkout. Workflow summaries report both the tag object/peeled release commit and the recovery-tooling commit.

A tag-push release does not substitute newer tooling: its tooling checkout and release source both come from the pushed tag, and preflight requires the tooling commit to equal the peeled release commit.

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

Each failed workflow writes the exact release ID, when resolved, plus retry and investigation guidance to its job summary.

## Release assets

Release-generated Compose and env files select the exact readable tag:

```text
ghcr.io/itsmeares/staaash:<tag>
```

`release-manifest.json` records tag object, commit SHA, image repository, verified OCI index digest, full immutable reference, platform, and OCI labels. `SHA256SUMS` covers Compose, env, and manifest files. The workflow validates both the normal tag selection and an optional `STAAASH_VERSION=<tag>@sha256:<digest>` override. Source files in the immutable release-tag checkout remain templates and are never uploaded directly as release assets.

## Controlled rehearsal

Before first production release using this workflow, run the full publication and recovery matrix in a disposable repository and separate GHCR package. Cover stable, RC, beta, CI failure, draft failure, image failure, partial assets, publication failure, promotion failure, matching/conflicting image, matching/conflicting release, tag movement, idempotent rerun, and prerelease-after-stable behavior.

Do not create rehearsal tags, images, or releases in `itsmeares/staaash`.
