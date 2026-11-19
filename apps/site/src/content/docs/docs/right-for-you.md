---
title: Is Staaash right for you?
description: When Staaash fits, and when a network share, Nextcloud, Syncthing or Immich fits better.
---

Staaash is a drive: your files on your own disk, open in any browser, shared with a link, and synced with the desktop app. It does that one job and stays small. Here is when it fits, and when something else fits better.

## Staaash fits when

- You want your files in a browser, on a laptop or a phone, without installing anything.
- You send folders and files to people who have no account, with a password or an end date.
- You run it for yourself, your family or a small group, and each person needs a private space.
- You want your files to stay normal files in normal folders, so you can copy them out at any time.
- You want one Docker Compose file and nothing else to look after.

## Pick something else when

| You need                                                        | A better fit          | Why                                                                                                                    |
| --------------------------------------------------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Calendars, contacts, office documents, chat or an app store     | Nextcloud             | Staaash is only a drive and will not grow into a suite.                                                                |
| Your phone's photos backed up by themselves                     | Immich                | Staaash has no phone app yet. You upload from the phone's browser.                                                     |
| Folders kept the same on several computers, with no server      | Syncthing             | Syncthing syncs devices directly. Staaash keeps one copy on a server, with a desktop app that syncs to it.             |
| A drive letter or mounted folder on every computer in the house | A network share (SMB) | Staaash opens in a browser and syncs chosen folders. It does not mount as a disk.                                      |
| A team workspace with shared editing and permissions per file   | A hosted team service | Staaash gives each person a private space and shares by link. It has no shared team folders.                           |
| A backup                                                        | A backup tool         | Staaash is a drive, not a backup. Back it up like any other data. See [Backup and Restore](/docs/backup-and-restore/). |

## Using them together

Staaash works next to the others, not instead of them.

- **With Immich:** Immich backs up the phone's photos, and Staaash holds everything else and shares folders by link.
- **With a network share:** keep the share for computers at home, and use Staaash to reach files from outside and to share them. Do not point both at the same folder. Staaash must be the only thing that changes its `library` folder.
- **With Syncthing:** Syncthing keeps two computers the same, and Staaash adds a browser view and share links.

## Still not sure

[Try the demo](https://demo.staaash.org/). It runs in your browser with sample files, so nothing you upload leaves your computer. Then follow [Installation](/docs/installation/). It takes a few minutes. To remove it again, run `docker compose down` and delete its folder.
