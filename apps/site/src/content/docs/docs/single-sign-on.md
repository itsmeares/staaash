---
title: Single Sign-On
description: Let people sign in with Pocket ID, Authentik, Authelia, Keycloak or another OIDC provider.
---

:::note[Coming in v2.1.0]
Single sign-on is not in a stable release yet.
:::

With single sign-on, people sign in to Staaash with the account they already have at your identity provider. Staaash works with any provider that speaks OpenID Connect (OIDC). This guide uses [Pocket ID](https://pocket-id.org).

Staaash knows a person by the provider's account ID, never by email alone. Someone gets in only if:

- their provider account is already connected to a Staaash account,
- they open an invite link you sent them, or
- you turned on automatic accounts and their email is not taken yet.

Everyone else sees "You don't have an account here."

## 1. Add Staaash to your provider

Staaash needs a fixed web address for this. Set `STAAASH_PUBLIC_URL` in `.env` first, for example `https://drive.example.com`. The callback URL is that address plus `/api/auth/oidc/callback`.

In Pocket ID:

1. Open **Administration**, then **OIDC Clients**, then **Add OIDC Client**.
2. Name it **Staaash** and add the callback URL, for example `https://drive.example.com/api/auth/oidc/callback`.
3. Press **Create**. Copy the **Client ID** and the **Client secret**. The secret is shown only once.
4. Optional: under **Allowed User Groups**, pick the groups that may sign in.

Staaash always uses PKCE, so you can turn on **PKCE** for the client too.

## 2. Tell Staaash about it

Add these lines to `.env`:

```dotenv
STAAASH_PUBLIC_URL=https://drive.example.com
OIDC_ISSUER_URL=https://id.example.com
OIDC_CLIENT_ID=paste-the-client-id
OIDC_CLIENT_SECRET=paste-the-client-secret
OIDC_PROVIDER_NAME=Pocket ID
```

Then run `docker compose up -d`. The sign-in page now has a **Sign in with Pocket ID** button. The server log prints the callback URL, so you can check it matches.

| Setting                         | What it does                                                                                                         | Default |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------- |
| `OIDC_ISSUER_URL`               | Your provider's address. The **OIDC Discovery URL** that Pocket ID shows works too. Setting it turns the button on.  | not set |
| `OIDC_CLIENT_ID`                | The client ID from your provider.                                                                                    | not set |
| `OIDC_CLIENT_SECRET`            | The client secret. Leave it empty for a public client.                                                               | not set |
| `OIDC_PROVIDER_NAME`            | The name on the button: "Sign in with ...".                                                                          | `SSO`   |
| `OIDC_AUTO_REGISTER`            | `true` makes a member account the first time someone signs in. Use it with **Allowed User Groups** at your provider. | `false` |
| `OIDC_DEFAULT_STORAGE_LIMIT_GB` | The storage limit for accounts made that way. Empty means no limit.                                                  | not set |
| `OIDC_ADMIN_GROUP`              | People in this provider group get **Admin access**. Staaash checks it at every sign-in.                              | not set |
| `OIDC_PASSWORD_LOGIN`           | `false` turns Staaash passwords off, so everyone signs in through the provider.                                      | `true`  |

A missing or broken setting stops Staaash from starting, and the log says which one. If the provider is down, the button shows an error and password sign-in keeps working.

## 3. Connect the people

**You, and anyone who already has a password:** sign in with your password, open **Settings**, and press **Connect** next to the provider's name. After that, the button signs you in.

**New people:** in **Admin → Users**, press **Invite** and keep **Signs in with Pocket ID** turned on. Staaash shows an invite link. Send it to them. When they open it and sign in at Pocket ID, their account is connected. The link works once, for 7 days. If it runs out, open the person and press **New invite link**.

Or set `OIDC_AUTO_REGISTER=true` and skip invites. Then the provider decides who gets in.

## The desktop app

Nothing changes. **Sign in with browser** opens the browser. If the browser is not signed in yet, it shows the sign-in page, where the provider's button works. After that, approve the computer as usual.

## Turn passwords off

With `OIDC_PASSWORD_LOGIN=false`, the sign-in page shows only the provider's button. **Change password** and **Reset password** go away, and invites always use invite links.

:::caution[Connect yourself first]
Press **Connect** in Settings before you turn passwords off. If your provider is down, nobody can sign in until you set `OIDC_PASSWORD_LOGIN=true` and run `docker compose up -d`.
:::

## Removing someone

Removing a person at your provider stops their next sign-in. Browsers and desktop apps that are already signed in stay signed in, because Staaash only asks the provider at sign-in. To cut them off now, also open them in **Admin → Users** and sign out their devices under **Signed in**.

## Other providers

The steps are the same everywhere: make a client with the callback URL, then copy the issuer address, client ID and secret.

| Provider  | Issuer address                                   | Notes                                                                                                  |
| --------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| Authentik | `https://auth.example.com/application/o/<slug>/` | Keep the slash at the end.                                                                             |
| Authelia  | `https://auth.example.com`                       | Set `token_endpoint_auth_method: client_secret_post` on the client. Staaash sends the secret that way. |
| Keycloak  | `https://keycloak.example.com/realms/<realm>`    | For `OIDC_ADMIN_GROUP`, add a **Group Membership** mapper named `groups`.                              |

## Disconnecting

In **Settings**, **Disconnect** removes the link. It shows only while you still have a password, so you cannot lock yourself out. The owner can disconnect anyone from **Admin → Users**, then send a new invite link.
