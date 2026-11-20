---
title: Installation
---

This page sets up Staaash with Docker. It takes a few minutes.

## What you need

- A Linux computer or server (Intel/AMD or ARM), or a Windows computer with Docker Desktop. To run it on Windows without Docker, see [Windows Server](/docs/windows-server/).
- Docker with the Compose plugin. Run `docker compose version`. If you see a version number, you are ready.

## Step 1. Download two files

Open the [releases page](https://github.com/itsmeares/staaash/releases), pick the newest release, and download `docker-compose.yml` and `example.env` from **Assets**. Put both in a new, empty folder.

## Step 2. Fill in your settings

1. Rename `example.env` to `.env`.
2. Open `.env` and set `DB_PASSWORD` to a long password. Use letters and numbers only. A symbol or a space breaks the database connection. `openssl rand -hex 24` makes a good one.

Leave the rest as it is. Every setting is explained in [Configuration](/docs/configuration/).

## Step 3. Start it

```console
docker compose up -d
docker compose ps
```

:::caution[Create your account right away]
Until you do step 4, anyone who can reach this port can create the owner account first. Do not forward the port to the internet before that. On a shared network, set `STAAASH_PORT=127.0.0.1:2113` in `.env` until your account exists, then remove it and run `docker compose up -d` again.
:::

On a server the internet can reach, such as a VPS, set `STAAASH_PORT=127.0.0.1:2113` before the first start and keep it. Open the setup page through an SSH tunnel: run `ssh -L 2113:localhost:2113 you@your-server` on your own computer, then open `http://localhost:2113` there. Put a [reverse proxy](/docs/reverse-proxy/) in front for everyday use.

The first start downloads the images, which can take a few minutes. `docker compose ps` should list `staaash_server`, `staaash_worker` and `staaash_postgres`, all running.

## Step 4. Create your account

Open `http://localhost:2113` in a browser. From another computer, use the server's address, for example `http://192.168.1.20:2113`. If you changed `STAAASH_PORT`, use that port.

The first account becomes the **owner**. Pick a strong password and keep it somewhere safe.

Your files are now in the `library` folder and your database is in the `postgres` folder, next to `docker-compose.yml`.

:::caution[Leave these folders to Staaash]
Do not edit or move anything inside `library` or `postgres` by hand. Staaash keeps track of every change it makes there, and a change it did not make can lose a file.
:::

## Next

- Back up now: [Backup and Restore](/docs/backup-and-restore/).
- Learn the everyday things: [Using the Drive](/docs/using-the-drive/).
- Reach it with a domain name and HTTPS: [Reverse Proxy](/docs/reverse-proxy/).
- Invite family or friends: [User Management](/docs/user-management/).
- It does not start: [Troubleshooting](/docs/troubleshooting/).
