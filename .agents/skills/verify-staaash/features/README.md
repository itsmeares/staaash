# Staaash verification map

This directory is the maintained map of user-facing Staaash checks. Read the
index before driving the app, then use the matching feature file.

## Baseline preconditions

- Start a new run with `.agents/skills/verify-staaash/run-demo.sh launch`.
- Use the tailnet URL printed by the helper.
- Run `doctor` before the feature journey.
- Use fake accounts and fake files only.
- Keep the run's project, network, volumes, image, builder, and state separate
  from every existing Staaash installation.
- Save screenshots, logs, and traces in the evidence directory before cleanup.

## Driving conventions

- Use Playwright with ARIA roles, labels, names, and the app's data attributes.
- Start each feature from a fresh demo unless the feature lists a precondition.
- Capture the action and the resulting state.
- Confirm saved state with a reload or a read-only second view.
- Run cleanup after success and after every failed attempt.

## Features

- [Owner setup and sign-in](./owner-setup.md) covers the empty-instance path.
- [Files and folders](./files-and-folders.md) covers creation and upload.
- [Trash and restore](./trash-and-restore.md) covers the way back out.
