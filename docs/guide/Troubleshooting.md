# Troubleshooting

Start with two commands. They answer most questions.

```console
docker compose ps
docker compose logs --tail 100 staaash worker db
```

`ps` shows which parts are running. `logs` shows the last lines each part wrote. Look for the word `error`.

## I cannot open Staaash

1. Run `docker compose ps`. `staaash_server`, `staaash_worker` and `staaash_postgres` should all be running.
2. Open `http://localhost:2113` on the same computer. If that works, the problem is the network between you and the server: the server address, a firewall, or the proxy.
3. If you set `STAAASH_PORT` in `.env`, use that port.
4. Behind a reverse proxy? Open the proxy address, not the port.

## The database will not start, or Staaash keeps restarting

- `DB_PASSWORD` must use letters and numbers only. A symbol or a space breaks the connection.
- The database remembers the password from its first start. If you change `DB_PASSWORD` in `.env` later, the database keeps the old one, and Staaash cannot sign in to it. Put the old password back.
- Read the last lines of `docker compose logs db` and `docker compose logs staaash`.

## Sign-in or uploads fail behind a proxy

Staaash checks that the address in the browser matches the address it was called with. A proxy that changes the host, or two different addresses for the same drive, make requests fail on purpose.

- Use one address everywhere.
- Make sure the proxy passes on the original Host and says the visit was HTTPS.
- Compare against [[Reverse Proxy]].

## Share links have the wrong address

Set `STAAASH_PUBLIC_URL` in `.env` to your public address, then run `docker compose up -d`. Links made after that use it. Links already sent keep their old address, so create a fresh share. See [[Configuration]].

## Previews are missing

Thumbnails and video previews come from the worker.

1. Open admin **Jobs**. It must say at least one worker is online.
2. If it says 0 online, run `docker compose logs worker` and `docker compose up -d`.
3. Open the **Activity** list and filter by **Failed**. A single broken video can fail without harming anything else.

## The disk is full

1. Open admin **Overview** and **Storage**. They show who uses the space.
2. Ask people to empty their trash. Trash is deleted for good after the cleanup time.
3. Add space on the disk, or move to a bigger disk. To move the library, follow the steps in [[Configuration]].

Do not delete files inside `library` by hand. Staaash tracks each file, and a hand delete leaves it confused.

## An upload stopped halfway

Unfinished uploads wait in a holding area and are cleaned up after a few hours. Try the upload again. If the same file keeps failing, check that the disk has space, and check the upload size limit under admin **Settings**, **Uploads**.

## The admin Overview shows a problem

| Line          | What to do                                                                                                                                             |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Database      | Check `docker compose logs db`.                                                                                                                        |
| Files volume  | The files folder is not writable. Check that the disk is mounted and has space.                                                                        |
| Worker        | Check `docker compose logs worker`, then `docker compose up -d`.                                                                                       |
| Disk space    | Free some space.                                                                                                                                       |
| Restore check | Files on disk do not match the database. Run it again from **Jobs** after a restore. If it still complains, keep everything as it is and ask for help. |

## A file says "Needs a storage check"

A move, rename or delete stopped halfway, and Staaash kept every byte instead of guessing. See [[Storage Check]].

## Health checks for monitoring

Two addresses answer without signing in, for tools like Uptime Kuma:

- `/api/health/live` answers 200 while the web app runs. Docker's health check uses it.
- `/api/health/ready` answers 200 when the database, the files folder and the worker are all fine. It answers 503 when one is not, or when a change needs a [[Storage Check]]. Its reply lists which check failed.

A failed preview job or another background job does not make `ready` fail. Those show in admin **Jobs**.

## It broke after an update

1. Check the logs for the first error.
2. Check that `STAAASH_VERSION` in `.env` is the version you meant, and that `docker-compose.yml` is from the same release.
3. Restore your backup if you cannot fix it. See [[Updating]] and [[Backup and Restore]].

## Asking for help

Ask in [GitHub Discussions](https://github.com/itsmeares/staaash/discussions). For a bug, open an issue with the Bug report form. Include:

- what you did and what you expected
- the Staaash version from admin **Overview**
- the last lines of `docker compose logs`

Do not paste passwords, your `.env` file, or private file names.
