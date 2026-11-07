# Windows Server

Staaash runs on Windows without Docker. One installer sets up the web app,
the worker, and PostgreSQL 18 as Windows services on the same computer.

It supports 64-bit Windows Server 2019 and newer, and Windows 10 and 11.

## Install

1. Download `Staaash-Server-<version>-win-x64.exe` from the
   [latest release](https://github.com/itsmeares/staaash/releases/latest).
   It is the server. `Staaash-Desktop-<version>-win-x64.exe` is the sync app.
2. Run it as an administrator. The installer is not code signed, so Windows
   may show "Windows protected your PC". Click More info, then Run anyway.
3. Choose:
   - the program folder (default `C:\Program Files\Staaash Server`);
   - the data folder (default `C:\ProgramData\Staaash`). Uploaded files, the
     database, and logs live here. Pick a drive with room for your files;
   - the web port (default `2113`);
   - the service account. Network Service can open only its data folder.
     Local System can open anything on the computer; pick it only when you
     know why;
   - whether other devices may connect. This adds a Windows Firewall rule for
     the web port only. The database listens on `127.0.0.1` and is never
     opened.
4. The installer waits until Staaash answers its health check, then opens
   `http://localhost:<port>/` to create the owner account.

For HTTPS, put a reverse proxy in front of the web port as described in
[reverse-proxy.md](reverse-proxy.md). With [Caddy for Windows](https://caddyserver.com/docs/install#windows),
a `Caddyfile` next to `caddy.exe` is enough:

```caddyfile
drive.example.com {
	reverse_proxy 127.0.0.1:2113
}
```

### Silent install

```console
Staaash-Server-<version>-win-x64.exe /S /DATA=D:\Staaash /PORT=2113 /ACCOUNT=NetworkService /FIREWALL=1
```

`/ACCOUNT` is `NetworkService` or `LocalSystem`. `/FIREWALL=0` skips the
firewall rule. The exit code is `0` when Staaash is up and `2` when it was
installed but did not start. `3` refuses a downgrade and `4` a data folder
from another PostgreSQL major version; both change nothing. Any other number
means setup failed, and `<data>\logs\setup.log` says why.

## What it creates

| Item                     | Where                                            |
| ------------------------ | ------------------------------------------------ |
| Uploaded files           | `<data>\files`                                   |
| Database                 | `<data>\postgres`                                |
| Logs                     | `<data>\logs`                                    |
| Settings and DB password | `<data>\staaash.env`                             |
| Services                 | `StaaashPostgres`, `StaaashWeb`, `StaaashWorker` |

The data folder is readable only by SYSTEM, Administrators, and Network
Service. `staaash.env` holds the settings from the Docker `.env`, such as
`STAAASH_PUBLIC_URL` and `SECURE_COOKIES`. After editing it, restart
`StaaashWeb` and `StaaashWorker` in Services.

## Update

Run the newer installer. It keeps the folders, port, and account from the
first install, stops the services, replaces the program folder, and starts
them again. The web service applies database migrations when it starts, as
the Docker image does. Back up first (below).

The installer refuses to install an older version over a newer one: a newer
version may have changed the database in ways an older one cannot read. To go
back, restore the backup you made before updating.

## Backup and restore

The rules in [backup-restore.md](backup-restore.md) apply. On Windows:

1. In an administrator PowerShell, stop the web service so no new change can
   start. `Stop-Service` returns once the service has stopped:

   ```powershell
   Stop-Service StaaashWeb
   ```

2. Let the worker finish unfinished storage changes. Repeat this until it
   returns no rows:

   ```powershell
   $url = (Select-String '^DATABASE_URL=' C:\ProgramData\Staaash\staaash.env).Line.Substring(13)
   'SELECT status, count(*) FROM "StorageMutation" WHERE status IN (''prepared'', ''running'', ''retrying'', ''metadata_committed'', ''finalizing'') GROUP BY status' |
     & 'C:\Program Files\Staaash Server\pgsql\bin\psql.exe' $url
   ```

   Change the paths if you picked other folders. Leave a
   `recovery_required` change as it is.

3. Stop the worker, then PostgreSQL:

   ```powershell
   Stop-Service StaaashWorker
   Stop-Service StaaashPostgres
   ```

4. Copy the whole data folder, including `files`, `postgres`, and
   `staaash.env`, into one backup set.
5. Start the services again in reverse order, or restart the computer.

To restore, stop the three services with the `Stop-Service` commands from steps
1 and 3, in that order, replace the data folder with the backup, and start
them again.

## Uninstall

Use Apps & features, or run `Uninstall.exe` in the program folder. It removes
the program, the services, and the firewall rule. It never deletes the data
folder. Delete that folder yourself to remove your files and database.

## Troubleshooting

- **The installer says setup failed.** Read `<data>\logs\setup.log`, fix
  the cause, and run the same installer again.
- **The installer says Staaash did not start.** Read the newest files in
  `<data>\logs`: `StaaashWeb.out.log` and `StaaashWeb.err.log` for the web
  app, `StaaashWorker.*.log` for the worker, and `logs\postgres` for the
  database.
- **A rename or move says the folder is busy.** Another program, often
  antivirus or a backup tool, has a file inside it open. Staaash waits a few
  seconds, then retries the change later on its own.
- **An upload says the name is already used**, but the names differ only in
  capitals. Windows treats `Photo.jpg` and `photo.jpg` as one file, so
  Staaash on Windows does too.
