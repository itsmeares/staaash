# Installation

This page sets up Staaash with Docker. It takes about ten minutes.

## What you need

- A Linux computer or server (Intel/AMD or ARM), or a Windows computer with Docker Desktop.
- Docker with the Compose plugin. Run `docker compose version`. If you see a version number, you are ready.

## Step 1. Download two files

Open the [releases page](https://github.com/itsmeares/staaash/releases), pick the newest release, and download `docker-compose.yml` and `example.env` from **Assets**. Put both in a new, empty folder.

## Step 2. Fill in your settings

1. Rename `example.env` to `.env`.
2. Open `.env` and set `DB_PASSWORD` to a long password. Use letters and numbers only. A symbol or a space breaks the database connection.

Leave the rest as it is. Every setting is explained in [[Configuration]].

## Step 3. Start it

```console
docker compose up -d
docker compose ps
```

The first start downloads the images, which can take a few minutes. `docker compose ps` should list `staaash_server`, `staaash_worker` and `staaash_postgres`, all running.

## Step 4. Create your account

Open `http://localhost:2113` in a browser. From another computer, use the server's address, for example `http://192.168.1.20:2113`.

The first account becomes the **owner**. Pick a strong password and keep it somewhere safe.

Your files are now in the `library` folder and your database is in the `postgres` folder, next to `docker-compose.yml`. Do not edit or move anything inside them by hand.

## Next

- Back up now: [[Backup and Restore]].
- Reach it with a domain name and HTTPS: [[Reverse Proxy]].
- Invite family or friends: [[User Management]].
- It does not start: [[Troubleshooting]].
