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

Port `2113/tcp` is the private connection between the reverse proxy and
Staaash. Do not forward it to the public internet. Publishing it gives clients
a second route that bypasses the proxy's HTTPS termination, request limits, and
other proxy controls. Public clients should reach only ports 80 and 443 on the
reverse proxy.

## Fast uploads from your LAN

This section applies when Staaash works at its public URL, but uploads from the
same home or office network are much slower than uploads sent directly to the
server's LAN address.

The public hostname may resolve to your public IP even while you are at home.
The router then has to send the connection back into the LAN through NAT
reflection, also called NAT loopback or hairpinning:

```text
Slow LAN route

Computer -> router public IP -> port forward -> reverse proxy -> Staaash
```

That extra router path can limit throughput. Staaash cannot choose the network
route. Fix it with local DNS while keeping the same HTTPS hostname.

### Check your current route

Run this on a Windows computer connected to the same LAN as the server:

```powershell
Resolve-DnsName drive.example.com
```

Replace `drive.example.com` with your Staaash hostname.

- If it returns the reverse proxy's private LAN address, such as
  `192.168.1.10`, the client already has a direct LAN route.
- If it returns your public IP or a public proxy address, the connection is not
  using a direct LAN route.

A much faster upload through the server's LAN address is another sign that the
public-hostname route is the bottleneck. Use the LAN address only for diagnosis.
Users should continue opening Staaash through its HTTPS hostname so cookies,
origin checks, and certificates keep working.

### Add a local DNS record

Create a DNS rewrite in your router, AdGuard Home, Pi-hole, or other LAN DNS
server:

```text
drive.example.com -> 192.168.1.10
```

Replace `192.168.1.10` with the fixed LAN address of the machine running the
reverse proxy. This setup is called split DNS:

```text
Outside your LAN: drive.example.com -> public IP -> router -> reverse proxy
Inside your LAN:  drive.example.com -> LAN IP ------------> reverse proxy
```

Users keep the same `https://drive.example.com` URL in both places. Only the
resolved IP changes. If the hostname has an IPv6 `AAAA` record, configure the
LAN DNS response for IPv6 too, or LAN clients may continue using the public
route.

### Make the reverse proxy available on LAN port 443

DNS records contain IP addresses, not ports. After the DNS rewrite, the browser
will connect to the proxy's LAN address on port 443.

Choose the case that matches your installation. Do not copy every example.

If your router forwards public port 443 to port 443 on the reverse proxy, no
extra listener is needed. The normal Caddy configuration in this guide handles
both LAN and internet traffic:

```text
Router: public 443 -> 192.168.1.10:443
Caddy:              192.168.1.10:443 -> staaash:2113
```

If your router forwards public port 443 to port 8443 on a Docker host, publish
both host ports to Caddy's port 443:

```yaml
ports:
  - "192.168.1.10:443:443"
  - "192.168.1.10:8443:443"
```

The router can keep sending internet traffic to `192.168.1.10:8443`. LAN
clients use `192.168.1.10:443`. Both reach the same Caddy site and Staaash URL.

If Caddy runs directly on the host and the router uses port 8443, configure both
listeners:

```caddyfile
(staaash_backend) {
    reverse_proxy 127.0.0.1:2113
}

https://drive.example.com:443 {
    bind 192.168.1.10
    import staaash_backend
}

https://drive.example.com:8443 {
    bind 192.168.1.10
    import staaash_backend
}
```

Binding the LAN address also lets another service use port 443 on a different
local address. Check existing listeners before changing the proxy:

```bash
sudo ss -ltnp '( sport = :443 or sport = :8443 )'
```

Do not expose Staaash port 2113 to work around a proxy or DNS problem.

### Verify the fix

Windows may cache the old DNS result. Clear it, resolve the hostname again, and
test HTTPS:

```powershell
Clear-DnsClientCache
Resolve-DnsName drive.example.com
Test-NetConnection drive.example.com -Port 443
curl.exe -I https://drive.example.com
```

The hostname should now resolve to the proxy's private LAN address, HTTPS should
succeed without a certificate warning, and the browser URL should remain
unchanged.

This change improves access only for devices using your LAN DNS server. It does
not prove or fix internet upload performance. Test the public route separately
from a mobile connection or another external network.
