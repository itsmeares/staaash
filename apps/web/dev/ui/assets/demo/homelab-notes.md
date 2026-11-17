# Homelab

The mini PC under the stairs. Two 4 TB disks in a mirror, about 18 W idle.

## What runs on it

| Service  | For                    | Address             |
| -------- | ---------------------- | ------------------- |
| Staaash  | Everyone's files       | drive.devries.home  |
| Jellyfin | Films and series       | films.devries.home  |
| Immich   | Photos from the phones | photos.devries.home |

## Backups

Every night at 03:00 to the old NAS at Opa Henk's house. See `backup.log`.

```sh
restic backup /srv/staaash --repo sftp:henk:/backups
```

## This month

- [x] Move Staaash to 2.0
- [x] New UPS battery
- [ ] Give Bram his own login on Jellyfin
- [ ] Test a restore from Henk's NAS
