# Reverse Proxy

A reverse proxy is a small program that stands in front of Staaash. People visit a name like `https://drive.example.com`. The proxy handles the secure HTTPS part, then passes the visit to Staaash.

You do not need one to use Staaash at home. You want one when you reach your drive from outside the house, or you want a nice name and a padlock in the browser.

This page uses Caddy. It gets and renews HTTPS certificates by itself.

## Before you start

- You own a domain name, such as `example.com`, and point `drive.example.com` at your server's public address.
- Ports 80 and 443 reach your server from the internet.

## Step 1. Write the Caddyfile

In your Staaash folder, create a file named `Caddyfile` (no extension) with this inside:

```caddyfile
drive.example.com {
    reverse_proxy staaash:2113
}
```

Use your own name instead of `drive.example.com`.

## Step 2. Add Caddy to your compose file

Add this under `services:` in `docker-compose.yml`:

```yaml
  caddy:
    image: caddy:latest
    container_name: staaash_caddy
    restart: always
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config
    depends_on:
      - staaash
```

Add this at the **top level** of the file, not inside `services:`:

```yaml
volumes:
  caddy_data:
  caddy_config:
```

## Step 3. Tell Staaash its public name

In `.env`:

```env
STAAASH_PUBLIC_URL=https://drive.example.com
```

Share links now use this name.

## Step 4. Close the direct door

Remove these lines from the `staaash` service, so only Caddy faces the internet:

```yaml
ports:
  - "2113:2113"
```

## Step 5. Start

```console
docker compose up -d
```

Open `https://drive.example.com`. You should see Staaash with a padlock.

If sign-in or uploads fail after this, see **Sign-in or uploads fail behind a proxy** in [[Troubleshooting]].

## Fast uploads at home

If uploads from inside your home network are slow because the traffic goes out to the internet and back, the full [reverse proxy guide](https://github.com/itsmeares/staaash/blob/main/docs/operations/reverse-proxy.md) shows how to keep that traffic local.
