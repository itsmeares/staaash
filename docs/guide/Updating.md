# Updating

Each Staaash release is built for one exact version of the app. To update, you point your install at the new version and restart it.

## Before you update

1. Make a backup of the files and the database. Follow [[Backup and Restore]]. Do not skip this step.
2. Read the notes of the new release on the [releases page](https://github.com/itsmeares/staaash/releases), or in the app's update notice. Read **⚠️ Upgrade notes** closely. It says when the release changes the database, the compose file or `example.env`. If you skip releases, read the upgrade notes of each one.
3. Check that the admin Overview shows no problems. See [[Admin Guide]].

Alpha and beta releases of Staaash cannot be updated to 2.0. Start a fresh install of the current version and move your files in through the app. Do not point it at the old database or storage folders.

Staaash shows a notice in the app when a new version exists. Admins can also press **Check now** on the Overview screen.

## Update

1. Find the tag of the new release, for example `vX.Y.Z`. It is the title of the release.
2. Open your `.env` file and set `STAAASH_VERSION` to that tag:

   ```env
   STAAASH_VERSION=vX.Y.Z
   ```

3. Download the new `docker-compose.yml` from the release **Assets** and replace your old one. If you use HTTPS from [[Reverse Proxy]], replace `compose.https.yml` and `Caddyfile` too. Keep your `.env` file.
4. Pull the new images and restart:

   ```console
   docker compose pull
   docker compose up -d
   ```

Staaash updates its own database when it starts. Give it a minute.

On the Windows server installer, run the newer installer instead. See [[Windows Server]].

## Check that it worked

1. Open Staaash and sign in.
2. Open the admin **Overview**. The version number should be the new one, and every health line should be green.
3. Open a few files, and upload a small one.

## If something goes wrong

Your old data is safe in your backup. Do not delete the backup until the new version has run well for a few days.

To go back to the old version, you restore the backup you made before the update. Set `STAAASH_VERSION` back to the old tag too. Do not only change the version back: a new version may have changed the database in a way the old version cannot read.

Read [[Troubleshooting]] if the app does not start after an update.

## Release candidates

A release marked "Pre-release" is a release candidate. It is for testing the next version. In admin **Settings**, under **Updates**, the **Channel** option controls which releases the update notice follows: Automatic, Stable or Release candidates. Leave it on Automatic or Stable unless you want to test.
