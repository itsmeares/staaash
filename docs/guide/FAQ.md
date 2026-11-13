# FAQ

## Does it work on Windows?

Yes. Use Docker Desktop and follow [[Installation]], or install the server without Docker. See [[Windows Server]].

## Is there a phone app?

Not yet. It is planned for later. Until then, open Staaash in your phone's browser. The pages fit a small screen. For syncing folders there is a [[Desktop App]] for Windows, macOS and Linux.

## Where are my files stored?

On your server's disk, in the `library` folder by default. Inside it, each person has a folder, and their files sit in normal folders with their real names. Do not rename, move or delete anything in there by hand. Staaash keeps track of every change, and a hand edit leaves it confused. You can look and copy for a backup.

## Is Staaash a backup?

No. It is a drive. If the disk dies or you delete a file for good, it is gone. Back up both the `library` and `postgres` folders. See [[Backup and Restore]].

## How do I move to another computer?

These steps are for Docker. On the Windows server installer, use the backup and restore steps in [[Windows Server]].

1. Make a backup as in [[Backup and Restore]].
2. Copy `docker-compose.yml`, `.env` and the backed-up `library` and `postgres` folders to the new computer. If you use the HTTPS setup, copy `compose.https.yml` and `Caddyfile` too.
3. If `.env` sets `UPLOAD_LOCATION` or `DB_DATA_LOCATION` to a full path, change it to where the folders are on the new computer.
4. Run `docker compose up -d` there, and open the admin **Jobs** screen to run **Restore check**.

## Can other people use my drive?

Yes. The owner invites them. Each person gets a private space and, if you want, a storage limit. See [[User Management]].

## Does Staaash email people?

No. When you invite someone, Staaash shows you a password once, and you send it to them.

## How do I get deleted files back?

Open **Trash** in the sidebar. Files stay there for 30 days by default, then are deleted for good.

## Something is wrong

See [[Troubleshooting]].
