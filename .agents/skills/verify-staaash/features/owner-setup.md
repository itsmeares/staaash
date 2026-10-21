# Owner setup and sign-in

The first person can name a new drive, create the owner account, finish the
setup choices, and reach Files.

## Sub-features

- `setup-drive` names an empty Staaash drive.
- `setup-owner` creates the first fake owner account.
- `setup-onboarding` saves the look, time, name, and preview choices.
- `setup-files` opens the signed-in Files page.

## How to get to it (user POV)

- Open the tailnet URL from a fresh run.
- Choose the first-run prompt.
- Complete the setup sentences and choose `Finish`.

## Driving it with Playwright

Preconditions:

- The demo database has no owner.
- `doctor` reports the expected project and the first-run page.

- **Start.** Open `/`. The text `Click anywhere or press any key` is visible.
- **Name the drive.** Click that text, fill `your drive`, and choose `Continue`.
- **Create the owner.** Fill `Email` and `Password`, then choose `Create account`.
- **Finish choices.** Choose `Dark`, `That's my time`, fill `your name`, choose `Continue`, and choose `Finish`.
- **Prove access.** The URL becomes `/files` and the `Files` breadcrumb is visible.

## Gotchas

- The password must be at least 12 characters.
- `Dark` advances after a short delay. Wait for `That's my time`.
- Do not reuse an account or database from another run.
- A health response alone does not prove that setup or sign-in worked.
