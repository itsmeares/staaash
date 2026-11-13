# Storage Check

Before Staaash moves, renames, trashes or restores anything on your disk, it writes the change down in the database. If a change stops halfway, for example because the power went out, Staaash reads that note and finishes the change when it starts again.

Sometimes it cannot tell what happened. Then it stops that one change and keeps every byte. Nothing is deleted while it waits for you.

## What you see

- **In the drive**, the file or folder shows **Finishing storage operation** while a change is still running. You cannot select it or open its actions until the change is done.
- If Staaash stopped the change, the item shows **Needs a storage check** instead. Click it to see a reference number.
- **In Admin → Storage**, the change is listed under **Unfinished changes**, with its operation ID and the paths it touches.

The rest of the drive works as usual.

## Most of the time it finishes by itself

A change in Admin → Storage with a yellow badge, such as **Retrying**, says **Finishing on its own**. It is waiting for something, like a full disk, a missing drive or a folder Staaash cannot write to.

1. Fix the cause. Free up disk space, reconnect the drive, or fix the folder permissions.
2. Wait a minute for the worker, or click **Retry now** next to the change.

## If it says Needs review

A red **Needs review** badge means Staaash found something it will not guess about, such as the same file in both the old and the new place. Waiting or refreshing will not fix it.

1. **Do not move or delete anything in your storage folder by hand.** That can turn a safe stop into a lost file.
2. Click **Copy recovery details** next to the change.
3. Find the operation ID in the worker log:

   ```console
   docker compose logs worker | grep <operation ID>
   ```

   On the Windows server, search the `StaaashWorker` logs in `<data>\logs` instead.

4. [Open an issue](https://github.com/itsmeares/staaash/issues/new/choose) and paste the details and the log lines. Leave out file names you do not want to share.

There is no button to clear a change that needs review yet. That is tracked in [issue #595](https://github.com/itsmeares/staaash/issues/595).

## If you are not the owner

Click **Needs a storage check** on the item, and send the reference number to whoever runs your Staaash.

## Backups and health checks

- A backup can wait for changes that finish on their own. Leave a change that needs review as it is, and back up anyway. See [[Backup and Restore]].
- While a change needs review, the ready health check answers `503`. See **Health checks for monitoring** in [[Troubleshooting]].
