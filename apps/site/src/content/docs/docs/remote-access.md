---
title: Remote Access
description: Reach your drive from outside the house with Tailscale, a VPN, a Cloudflare Tunnel or port forwarding.
---

At home, you open Staaash at your server's address, such as `http://192.168.1.10:2113`. To reach it from anywhere else, pick one of these.

| Way                                                      | Opens on your router               | Share links work for anyone | Setup     |
| -------------------------------------------------------- | ---------------------------------- | --------------------------- | --------- |
| [Tailscale](#tailscale)                                  | Nothing                            | No, only your devices       | Easiest   |
| [WireGuard or another VPN](#wireguard-or-another-vpn)    | One VPN port                       | No, only your devices       | Medium    |
| [Cloudflare Tunnel](#cloudflare-tunnel)                  | Nothing, public through Cloudflare | Yes                         | Medium    |
| [Port forwarding](#port-forwarding-with-a-reverse-proxy) | Ports 80 and 443                   | Yes                         | Most work |

If only you and your family use the drive, start with Tailscale. If you send share links to people outside, you need a Cloudflare Tunnel or port forwarding.

Never forward port 2113 itself on your router. Staaash expects HTTPS from a proxy in front of it when it faces the internet.

This page is for a server at home behind a router. A rented server with its own public address, such as a VPS, has no router in front of it, so Docker opens port 2113 to the internet. There, set `STAAASH_PORT=127.0.0.1:2113` and put a [reverse proxy](/docs/reverse-proxy/) in front.

## Tailscale

[Tailscale](https://tailscale.com) puts your devices on a private network with each other. You open no port on your router for it.

1. Install Tailscale on the server and sign in.
2. Install it on your phone and laptop, and sign in with the same account.
3. Find the server's Tailscale address with `tailscale ip -4`. It starts with `100.`.
4. Open `http://100.x.y.z:2113` on any of your devices.

Staaash works over plain HTTP here, because Tailscale already encrypts the connection between your devices. Sign-in and uploads work the same as at home.

If you set `STAAASH_PORT=127.0.0.1:2113` for a reverse proxy, port 2113 only answers on the server itself, so step 4 fails. Keep that line and open the proxy's address over Tailscale instead.

Share links use the Tailscale address you opened Staaash at, so only people on your Tailscale network can open them. If you set `STAAASH_PUBLIC_URL`, share links use that address instead.

## WireGuard or another VPN

A VPN on your router or server, such as WireGuard, does the same as Tailscale: your phone joins your home network and opens Staaash at its home address, such as `http://192.168.1.10:2113`.

Your router forwards one UDP port to the VPN, not to Staaash. Follow your router's or VPN's own guide to set it up. Nothing changes in Staaash.

## Cloudflare Tunnel

A [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/) gives your drive a public name, such as `https://drive.example.com`, without opening any port on your router. A small program on your server connects out to Cloudflare, and visits come in through it. Your domain must use Cloudflare for its DNS.

1. In the Cloudflare dashboard, open **Zero Trust**, then **Networks**, then **Tunnels**, and create a tunnel with **Cloudflared**.
2. Run the install command it shows on your server, or add `cloudflared` to Docker with the token it gives you.
3. Add a public hostname: `drive.example.com`, service type `HTTP`, URL `localhost:2113`. If `cloudflared` runs in Docker next to Staaash, use `staaash:2113` and put both on the same network.
4. In `.env`, set `STAAASH_PUBLIC_URL=https://drive.example.com`, then run `docker compose up -d`.

Cloudflare handles HTTPS and tells Staaash the visit was secure, so sign-in works.

Things to know before you rely on it:

- On its Free plan, Cloudflare rejects any request bigger than 100 MB. The browser sends files of 100 MiB and up in pieces of up to 32 MiB, which fit. A file just under 100 MiB goes in one request and can go over the limit. If such a file fails, upload it at home or over Tailscale.

- Every file passes through Cloudflare's servers on its way to you. Staaash still runs on your disk, but you are trusting Cloudflare with the traffic.
- Cloudflare's terms for its free network limit sites that mostly serve video or other large files. They do not say plainly how that applies to tunnels. If your drive is mostly video, Tailscale or port forwarding avoids the question.

## Port forwarding with a reverse proxy

Your router sends ports 80 and 443 to your server, where a reverse proxy adds HTTPS and passes visits on to Staaash. This needs a domain name pointing at your home's public address.

From 2.0, each release ships a ready setup with Caddy. The [Reverse Proxy](/docs/reverse-proxy/) guide covers it, and examples for Traefik and Nginx Proxy Manager if you already run one.

If your internet provider changes your public address from time to time, use a dynamic DNS service to keep the name pointing at it. Some providers put you behind a shared address (CGNAT), where port forwarding cannot work at all. Then use Tailscale or a Cloudflare Tunnel.
