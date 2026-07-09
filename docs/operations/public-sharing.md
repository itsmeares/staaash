# Public Sharing URLs

Staaash can share links from either a direct HTTP address or a public HTTPS
address.

## Direct HTTP

This works with the default Docker setup:

```env
STAAASH_PUBLIC_URL=
```

Share links use the address from the incoming request, such as
`http://STATIC_IP:2113`. This is fine for normal browser sharing, but Discord may
not play video embeds from plain HTTP URLs.

## Public HTTPS

For Discord video playback, put Staaash behind a real HTTPS hostname and set:

```env
STAAASH_PUBLIC_URL=https://drive.example.com
SECURE_COOKIES=true
```

The reverse proxy or tunnel should forward traffic to Staaash on port `2113` and
preserve the original `Host` header. It should also send:

```text
X-Forwarded-Proto: https
```

`X-Forwarded-Host` is not used. If your proxy rewrites `Host`, configure it to
preserve the public host or set `STAAASH_PUBLIC_URL`.

With `STAAASH_PUBLIC_URL` set, generated share links and Open Graph metadata use
that HTTPS address. Existing HTTP access still works if your network exposes it,
but Discord embeds should use the HTTPS share URL.

Discord caches embed metadata, so repost the link or create a fresh share after
changing this setting.
