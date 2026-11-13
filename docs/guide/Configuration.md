# Configuration

Staaash has two places for settings:

- The `.env` file next to your `docker-compose.yml`. It holds things that must be known when Staaash starts, like folders and the database password. After you change it, run `docker compose up -d` to apply it.
- The admin **Settings** screen inside the app. It holds everyday choices, like upload size. Changes apply right away.

## The `.env` file

| Setting                                  | What it does                                                                                                                         | Default      |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------ |
| `UPLOAD_LOCATION`                        | The folder on your computer that holds your files.                                                                                   | `./library`  |
| `DB_DATA_LOCATION`                       | The folder on your computer that holds the database.                                                                                 | `./postgres` |
| `DB_PASSWORD`                            | The database password. Use letters and numbers only. Change it before the first start. To make one: `openssl rand -hex 24`.          | `change-me`  |
| `STAAASH_PORT`                           | The port Staaash opens on your computer. See [Change the port](#change-the-port).                                                    | `2113`       |
| `STAAASH_PUBLIC_URL`                     | The web address people use, such as `https://drive.example.com`. Share links use it. Leave it unset if you only use Staaash at home. | not set      |
| `STAAASH_VERSION`                        | Which version of Staaash to run. Release files set this to an exact version.                                                         | `latest`     |
| `COMPOSE_FILE`, `COMPOSE_PATH_SEPARATOR` | Turn on HTTPS with the release files. See [[Reverse Proxy]].                                                                         | not set      |
| `DB_USERNAME`                            | The database user. Leave it alone.                                                                                                   | `postgres`   |
| `DB_DATABASE_NAME`                       | The database name. Leave it alone.                                                                                                   | `staaash`    |
| `SECURE_COOKIES`                         | `true` or `false`. Usually you do not need it. Staaash already uses secure cookies on HTTPS and normal cookies on plain HTTP.        | not set      |
| `UPLOAD_STAGING_RETENTION_HOURS`         | How many hours a half-finished upload is kept before cleanup. When set, it wins over the admin setting.                              | 2 hours      |

`DB_USERNAME`, `DB_DATABASE_NAME`, `SECURE_COOKIES` and `UPLOAD_STAGING_RETENTION_HOURS` are under **Advanced** in `example.env`, with a `#` in front. Remove the `#` only if you need one.

Change the storage folders **before** the first start. If you move them later, stop Staaash, move the folder, update `.env`, and start again. The database folder and the files folder must always stay a matching pair.

Do not edit the `volumes:` lines inside `docker-compose.yml`. Change `UPLOAD_LOCATION` and `DB_DATA_LOCATION` in `.env` instead.

### Change the port

Staaash listens on port `2113`. To use another port, set it in `.env` and run `docker compose up -d`:

```env
STAAASH_PORT=8080
```

Now Staaash is at `http://localhost:8080`. Do not change the port in `docker-compose.yml`. The next update replaces that file, and your change with it.

To keep Staaash reachable only from the same computer, for example behind a proxy, use `STAAASH_PORT=127.0.0.1:2113`.

### Share link address

If people open your drive through a domain name, set `STAAASH_PUBLIC_URL` so share links use that name. Without it, links use whatever address the person created them from. See [[Reverse Proxy]].

## Admin settings inside the app

Only the owner can open these. Go to **Admin**, then **Settings**.

| Section        | What you can change                                                                                                                                                                          |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Uploads        | Largest single file, how long one upload may take, how long unfinished uploads are kept, and the space unfinished uploads may use per person and in total.                                   |
| Media previews | Small pictures of photos and videos, smaller video copies for smooth playback, and when to make them (on upload, on first play, or when shared). Video copies use a lot of processing power. |
| Sessions       | How long people stay signed in, and the longest expiry a share link may have.                                                                                                                |
| Downloads      | How long generated zip files are kept.                                                                                                                                                       |
| Updates        | Whether to check for new versions, and which releases to follow: Automatic, Stable or Release candidates.                                                                                    |
| Scheduling     | The drive time zone, and the time of daily maintenance.                                                                                                                                      |
| Worker         | When the worker counts as down because it has not reported in.                                                                                                                               |

Hover or read the small text under each setting. It says what the setting does. When a section differs from the defaults, a reset button appears to put it back.

## Per-person limits

The owner can give each person a storage limit. See [[User Management]].
