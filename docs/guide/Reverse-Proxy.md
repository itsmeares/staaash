# Reverse Proxy

A reverse proxy is a small program that stands in front of Staaash. People visit a name like `https://drive.example.com`. The proxy handles the secure HTTPS part, then passes the visit to Staaash.

You do not need one to use Staaash at home. You want one when you reach your drive from outside the house, or you want a nice name and a padlock in the browser.

Each release ships a ready setup with Caddy, which gets and renews HTTPS certificates by itself. If you already run a proxy, skip to [Your own proxy](#your-own-proxy).

## Before you start

- You own a domain name, such as `example.com`, and point `drive.example.com` at your server's public address.
- Your router sends ports 80 and 443 to your server. Do not forward port 2113.

## HTTPS with the release files

1. Download `compose.https.yml` and `Caddyfile` from the release **Assets**. Put them next to `docker-compose.yml`.
2. Add or change these lines in `.env`:

   ```env
   STAAASH_PUBLIC_URL=https://drive.example.com
   STAAASH_PORT=127.0.0.1:2113
   COMPOSE_PATH_SEPARATOR=,
   COMPOSE_FILE=docker-compose.yml,compose.https.yml
   ```

   Use your own name instead of `drive.example.com`. `STAAASH_PORT=127.0.0.1:2113` keeps Staaash's own port on this computer, so visits from the network go through Caddy. The last two lines tell Docker to use both files. They work the same on Linux, macOS and Windows.

3. Start it:

   ```console
   docker compose up -d
   ```

Open `https://drive.example.com`. You should see Staaash with a padlock. Share links now use this name.

You don't need to edit the `Caddyfile`. It reads the address from `STAAASH_PUBLIC_URL`. When you update Staaash, download the new `compose.https.yml` and `Caddyfile` along with `docker-compose.yml`.

HTTP/3 is off in this `Caddyfile`. In our tests it used about 2.5 times more processing per megabyte and uploaded about 45% slower than HTTP/2.

## Your own proxy

Point your proxy at port 2113 and set `STAAASH_PUBLIC_URL` to the public address. A Caddy running on the same computer needs only this:

```caddyfile
drive.example.com {
    reverse_proxy 127.0.0.1:2113
}
```

Keep these rules, or sign-in and uploads fail on purpose:

- **Use one address everywhere.** Do not open Staaash at `https://drive.example.com` and send requests to a LAN address or another port.
- **Pass on the original `Host`.** Staaash checks that the browser's address matches the address it was called with.
- **Say the visit was HTTPS.** When the proxy talks to Staaash over plain HTTP, it must send `X-Forwarded-Proto: https`. Caddy does this by itself.

When the proxy runs on the same computer, set `STAAASH_PORT=127.0.0.1:2113` in `.env`, so nobody can skip the proxy.

## Fast uploads at home

If uploads are slow from inside your home but fine from outside, your devices are probably sending them out to the internet and back in through the router. Keep the same address, and make it point straight at your server when you are home.

1. **Check the route.** On a Windows computer at home, run `Resolve-DnsName drive.example.com`. On macOS or Linux, run `dig +short drive.example.com`. If you see your server's home address, such as `192.168.1.10`, the route is already local. If you see your public address, continue.
2. **Add a local DNS record.** In your router, AdGuard Home, Pi-hole or other home DNS, point `drive.example.com` to the server's home address. If the name also has an IPv6 (`AAAA`) record, add a home answer for that too.
3. **Make the proxy answer on port 443 at home.** If your router sends public port 443 to port 443 on the server, you are done. If it sends it to another port, such as 8443, the proxy must also listen on 443 at the home address. With your own Caddy, add a second block:

   ```caddyfile
   https://drive.example.com:443 {
       bind 192.168.1.10
       reverse_proxy 127.0.0.1:2113
   }
   ```

4. **Check it.** Clear the DNS cache (`Clear-DnsClientCache` on Windows), resolve the name again, and open `https://drive.example.com`. The padlock should still be there, and the address bar should not change.

This only speeds up devices that use your home DNS. It does not change uploads from outside.

If sign-in or uploads fail after any of this, see **Sign-in or uploads fail behind a proxy** in [[Troubleshooting]].
