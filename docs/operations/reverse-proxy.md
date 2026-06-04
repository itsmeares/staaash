# Reverse Proxy

Staaash can run behind Caddy, Nginx, Traefik, or another reverse proxy.

A reverse proxy is recommended when you want to serve Staaash from a real domain with HTTPS, such as:

```text
https://drive.example.com
```

## Important rules

Use one public address consistently.

Do not load Staaash from one address and post to another address, such as loading the app from `https://drive.example.com` but submitting requests to a LAN IP, direct server IP, or a different port.

Preserve the original `Host` header.

Staaash compares the browser `Origin` host to the request `Host` for mutating requests. If your proxy rewrites the host incorrectly, requests can fail by design.

If your proxy terminates HTTPS and forwards traffic to Staaash over HTTP, make sure it forwards the original protocol as HTTPS.

## Caddy example

Caddy is the simplest recommended reverse proxy for most home and small self-hosted installs because it manages HTTPS certificates automatically.

Create a file named `Caddyfile`, no extensions. You can use a notepad app or something like `nano` to edit that file.

Example `Caddyfile`:

```caddyfile
drive.example.com {
    reverse_proxy staaash:2113
}
```

Set the canonical public URL in `.env`:

```env
STAAASH_PUBLIC_URL=https://drive.example.com
```

`SECURE_COOKIES` is usually not needed. By default, Staaash uses secure cookies on HTTPS and non-secure cookies on plain HTTP.

## Docker Compose example

If Caddy runs in the same Compose project as Staaash, it can reach the app through the internal Docker network at `staaash:2113`.

Add a Caddy service:

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

Add the named volumes at the top level of the Compose file:

```yaml
volumes:
  caddy_data:
  caddy_config:
```

The `volumes:` block must be at the top level of the file, not inside `services:`.

## Do not expose Staaash directly

When using a reverse proxy, expose only the proxy to the internet.

Remove this from the `staaash` service unless you intentionally want direct access:

```yaml
ports:
  - "2113:2113"
```

Caddy can still reach Staaash internally through:

```text
http://staaash:2113
```

Your public traffic should look like this:

```text
Internet
  -> 80/443
  -> Caddy
  -> staaash:2113
```

## DNS and ports

Create a DNS record for your public hostname:

```text
drive.example.com -> your server public IP
```

Forward only HTTP and HTTPS to the machine running Caddy:

```text
80/tcp
443/tcp
```

You should not forward Staaash's internal port `2113/tcp` to the public internet when using a reverse proxy.
