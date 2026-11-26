---
title: Storage Check
description: What to do when a file move, rename or delete stopped halfway.
---

Before Staaash moves, renames, trashes or restores anything on your disk, it writes the change down in the database. If a change stops halfway, for example because the power went out, Staaash reads that note and finishes the change when it starts again.

Sometimes it cannot tell what happened. Then it stops that one change and keeps every byte. Nothing is deleted while it waits for you.

## What you see

- **In the drive**, the file or folder shows **Finishing storage operation** while a change is still running. You cannot select it or open its actions until the change is done.
- If Staaash stopped the change, the item shows **Needs a storage check** instead. Click it to see a reference number.
- **In Admin → Storage**, a running change is listed under **Unfinished changes**, with its operation ID and the paths it touches. A stopped change is listed under **Needs review**.

The rest of the drive works as usual.

## Most of the time it finishes by itself

A change in Admin → Storage with a yellow badge, such as **Retrying**, says **Finishing on its own**. It is waiting for something, like a full disk, a missing drive or a folder Staaash cannot write to.

1. Fix the cause. Free up disk space, reconnect the drive, or fix the folder permissions.
2. Wait a minute for the worker, or click **Retry now** next to the change.

## If it says Needs review

:::note[Coming in v2.1.0]
Older versions have no review page. On those, click **Copy** next to the change in Admin → Storage instead, then follow the last part of this section and open an issue.
:::

A red **Needs review** badge means Staaash found something it will not guess about, such as the same folder in both the old and the new place. Waiting or refreshing will not fix it.

Staaash fixes some of these by itself within a minute, when only one answer keeps every byte. For example, if a moved folder is already complete in its new place and only empty folders are left in the old one, it removes the empty folders. It never deletes a file to fix a change. Anything left over becomes a copy in the person's drive.

The rest wait for you under **Needs review** in Admin → Storage. Click **Review**. The page checks the disk, shows what it found in each place, and offers only the choices that fit:

- **Finish** lets the change go ahead. Anything still in the old place becomes a copy.
- **Keep** accepts the file or folder the way it is on disk now.
- **Undo** puts the item back where it was. Staaash offers it only before the change has updated the drive.
- **Remove** takes the item out of the drive when it is in neither place. Staaash asks first.
- **Check again** looks at the disk again, for example after you fixed something on the server.

Only the owner of the instance can choose. Admins can open the page but see no buttons.

A copy sits next to the original, with a name like `Photos (recovered, 2026-11-25 14-09)`. Copies count toward the person's storage limit, even when that puts them over it. The next time the person opens Staaash, a notice tells them about the copy and **Show** takes them to it.

:::danger[Do not touch the storage folder]
Do not move or delete anything in your storage folder by hand, unless the review page tells you to. That can turn a safe stop into a lost file.
:::

If the page says **Fix it on the server**, Staaash found a shortcut (symlink), a special file, or a folder it cannot read. Staaash never touches those. Do what the page says on the server, then click **Check again**.

If none of that helps:

1. Click **Copy** on the review page. It copies the recovery details.
2. Find the operation ID in the worker log:

   ```console
   docker compose logs worker | grep <operation ID>
   ```

   On the Windows server, search the `StaaashWorker` logs in `<data>\logs` instead.

3. [Open an issue](https://github.com/itsmeares/staaash/issues/new/choose) and paste the details and the log lines. Leave out file names you do not want to share.

## If you are not the owner

Click **Needs a storage check** on the item, and send the reference number to whoever runs your Staaash.

## Backups and health checks

- A backup can wait for changes that finish on their own. Leave a change that needs review as it is, and back up anyway. See [Backup and Restore](/docs/backup-and-restore/).
- While a change needs review, the ready health check answers `503`. See **Health checks for monitoring** in [Troubleshooting](/docs/troubleshooting/).
