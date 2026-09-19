<div align="center">
<p align="center">
  <picture>
    <source media="(prefers-color-scheme: light)" srcset="../design/App/Staaash%20App%20Icon-White%400.25.png">
    <source media="(prefers-color-scheme: dark)" srcset="../design/App/Staaash%20App%20Icon%400.25.png">
    <img src="../design/App/Staaash%20App%20Icon%400.25.png" alt="Staaash" width="192" height="192">
  </picture>
</p>
<h1>Staaash</h1>

[![License: AGPL-3.0](https://img.shields.io/github/license/itsmeares/staaash?style=for-the-badge&label=license)](../LICENSE)
[![Latest release](https://img.shields.io/github/v/release/itsmeares/staaash?style=for-the-badge&label=latest%20release&logo=github&logoColor=white)](https://github.com/itsmeares/staaash/releases)
[![Docker pulls](https://ghcr-badge.elias.eu.org/shield/itsmeares/staaash/staaash)](https://github.com/itsmeares/staaash/pkgs/container/staaash)
[![CI](https://img.shields.io/github/actions/workflow/status/itsmeares/staaash/ci.yml?branch=main&style=for-the-badge&label=ci&logo=githubactions&logoColor=white)](https://github.com/itsmeares/staaash/actions/workflows/ci.yml)

</div>

## Your files, on your hardware.

> [!IMPORTANT]
> Staaash is a file drive, not a backup system. Keep an independent backup of important files and test that you can restore it.

Staaash is a self-hosted file drive for people who want the convenience of a cloud drive without handing their files to a cloud provider. It gives you folders, uploads, previews, sharing, and user accounts in a browser, backed by storage you control.

It supports resumable uploads, public links, media previews, multiple users, storage quotas, and trash and restore.

<table>
  <tr>
    <td colspan="2">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="../docs/assets/readme/home-dashboard-dark.png">
        <img src="../docs/assets/readme/home-dashboard-light.png" alt="Staaash home dashboard with pinned items, recent activity, populated folders, and a shared folder">
      </picture>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="../docs/assets/readme/files-dark.png">
        <img src="../docs/assets/readme/files-light.png" alt="Staaash files view with folders, files, sizes, and modification dates">
      </picture>
    </td>
    <td width="50%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="../docs/assets/readme/share-page-dark.png">
        <img src="../docs/assets/readme/share-page-light.png" alt="Staaash public file share with an inline media preview">
      </picture>
    </td>
  </tr>
</table>

## Get started

### Requirements

- Docker with Compose Plugin
- AMD64 host

Download the current release files into an empty directory:

- [docker-compose.yml](https://github.com/itsmeares/staaash/releases/latest/download/docker-compose.yml)
- [example.env](https://github.com/itsmeares/staaash/releases/latest/download/example.env)

Then:

1. Rename `example.env` to `.env`.
2. Set `DB_PASSWORD` to a long, unique alphanumeric value. Change `UPLOAD_LOCATION` or `DB_DATA_LOCATION` if you need different host paths.
3. Start the stack:

   ```console
   docker compose up -d
   ```

4. Open [http://localhost:2113](http://localhost:2113). The first account becomes the owner and an admin.

The release files are the supported installation path. Files on `main` may contain unreleased changes.

## Learn more

- Read the [backup and restore checklist](../docs/operations/backup-restore.md) before storing important files.
- Use the [reverse proxy guide](../docs/operations/reverse-proxy.md) when exposing Staaash through a domain.
- Read the target [release notes](https://github.com/itsmeares/staaash/releases) before upgrading.
- Use the [storage mutation recovery guide](../docs/operations/storage-mutation-recovery.md) if storage operations become unavailable.
- See the [architecture](../docs/architecture.md) and [resumable upload](../docs/operations/resumable-uploads.md) docs for deeper technical detail.

## Community

- Ask questions, suggest ideas, and share feedback in [GitHub Discussions](https://github.com/itsmeares/staaash/discussions).
- Report bugs and request features through the issue tracker.
- Read [CONTRIBUTING.md](./CONTRIBUTING.md) before changing the code.
- Report security problems privately through the [security policy](./SECURITY.md).

## AI-assisted development

Most of Staaash's application code and tests were written with AI coding tools. I direct the architecture, priorities, and product decisions. User-facing documentation is reviewed and finalized by me.

## License

AGPL-3.0. See [LICENSE](../LICENSE).
