---
name: verify-staaash
description: "Verify Staaash through its web UI in a fresh Docker demo. Use it when a change needs proof that the real drive starts, accepts a user action, and keeps the result."
---

# Verify Staaash

Use this skill for a real web check of Staaash. The web container and worker
run from the current checkout. PostgreSQL and the file store are new for every
run.

The helper refuses to use the live `staaash` project. It creates a unique
project name, network, volumes, image tag, and Buildx builder. It uses fake
account data only. Never replace its project name with an existing one.

## Launch

Run these commands from the repository root:

```bash
RUN_ENV="$(.agents/skills/verify-staaash/run-demo.sh launch)"
.agents/skills/verify-staaash/run-demo.sh doctor "$RUN_ENV"
```

`launch` builds the image, starts PostgreSQL, runs the web migration command,
starts the worker, and waits for the live endpoint and the usable first-run
page. An empty instance reports `503` readiness until its owner exists. After
setup, `doctor` requires the ready endpoint to return `200`. Launch binds the
web port only to the tailnet IP and `127.0.0.1`, then prints a tailnet URL. Use
that URL from another device. That is the only URL to give a person. Do not
replace it with a local-only URL.

The first page is the empty-instance owner setup. The Drive step below creates
the fake owner through that page and finishes onboarding. This is the seed for
the run. The launch output and the generated `run-info.txt` file contain the
project name, image, ports, tailnet URL, and evidence directory.

The machine is small, so the compose override caps the web container at 0.75
CPU and 768 MB, the worker at 0.5 CPU and 512 MB, and PostgreSQL at 0.5 CPU
and 512 MB.

## Doctor

Run `doctor` before driving the app and again after the drive:

```bash
.agents/skills/verify-staaash/run-demo.sh doctor "$RUN_ENV"
```

It checks the exact Compose project, the three containers, the image tag, the
published ports, both health endpoints, and the auth session. Before setup it
checks that the first-run page is present. After `drive` it checks the fake
owner session from a scratch cookie file. It writes the check results to the
evidence directory.

If the project, image, port owner, or URL is wrong, stop. Do not drive a
container that this run did not create.

## Drive

The helper uses the repo's Playwright dependency and the app's real user
selectors. It completes owner setup, opens the New menu, creates a folder,
reloads the Files page, and checks the saved folder in PostgreSQL with a
read-only query:

```bash
.agents/skills/verify-staaash/run-demo.sh drive "$RUN_ENV"
```

The mapped recipes live in `features/`. Start from a new run for each recipe.
Do not call internal service functions or test-only endpoints to make a state
change. Use the page and its normal controls.

## Evidence

The helper saves evidence under the run's separate evidence directory. It
keeps the directory when cleanup removes the demo:

- `01-first-run.png` shows the first-run page before the action.
- `02-files-ready.png` shows the drive after onboarding.
- `03-new-menu.png` shows the user opening New.
- `04-folder-draft.png` shows the folder name before saving.
- `05-folder-created.png` shows the new folder after saving.
- `06-folder-reloaded.png` shows the folder after a page reload.
- `drive.log` records the URL, fake account, folder, and exit result.
- `db-folder-check.txt` records the read-only database result.
- `trace.zip` records the browser actions and page state.
- `compose.log` and `compose-ps.txt` are written before cleanup.

The proof must show the user action and its result. A final screenshot alone
does not prove the action worked. A visible row plus the reload and database
read prove that the folder survived the request.

## Cleanup

Run cleanup after every drive, including a failed drive:

```bash
.agents/skills/verify-staaash/run-demo.sh cleanup "$RUN_ENV"
```

Cleanup uses only the saved project, container names, volumes, image tag, and
Buildx builder from that run. It removes the containers, named volumes,
network, image, builder, and scratch state directory. It does not remove any
other Docker object. It never stops containers by name pattern.

Cleanup does not remove the evidence directory. The helper prints its exact
path before it removes the scratch state. Save that path, then check the proof
after cleanup:

```bash
test -s "$EVIDENCE_DIR/drive.log"
test -s "$EVIDENCE_DIR/trace.zip"
test -s "$EVIDENCE_DIR/db-folder-check.txt"
```

## Helpers

The skill ships two executable helpers:

- `run-demo.sh` launches, diagnoses, drives, and cleans one isolated run.
- `drive-folder.mjs` is the Playwright journey called by `run-demo.sh drive`.

The normal invocation is:

```bash
RUN_ENV="$(.agents/skills/verify-staaash/run-demo.sh launch)"
.agents/skills/verify-staaash/run-demo.sh doctor "$RUN_ENV"
.agents/skills/verify-staaash/run-demo.sh drive "$RUN_ENV"
.agents/skills/verify-staaash/run-demo.sh doctor "$RUN_ENV"
.agents/skills/verify-staaash/run-demo.sh cleanup "$RUN_ENV"
```

Update this skill when routes, selectors, startup, or user journeys change.
