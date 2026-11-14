# Staaash

Staaash is a drive that lives on your own computer. You put files in, and you get them back from any browser or from the desktop app. Nobody else holds your files.

It is free and open source.

## What you can do

- Upload files and folders, and download them again.
- Browse, search, favorite and pin files.
- See photo and video previews.
- Send a link to a file or folder. Add a password or an end date, and turn it off whenever you like.
- Get deleted files back from the trash for 30 days by default.
- Keep a folder on your computer in sync with your drive.
- Share one drive with family or friends, each with a private space and an optional storage limit.

## Three promises

1. **Your files stay safe.** Every change to your storage survives a crash or a restart. When Staaash is not sure what happened, it keeps every file and stops.
2. **One box to run.** Docker, a database and a disk. Nothing else to set up.
3. **Small on purpose.** It is a drive for one person or a small group. It is not a team workspace, and it will not grow into a platform.

## What you need

A computer or server with Docker. That can be Linux, or Windows with Docker Desktop. Staaash runs on Intel/AMD and ARM.

On 64-bit Windows you can also skip Docker. See [[Windows Server]].

## Where to begin

**New here**

1. [[Installation]]. Be running in a few minutes.
2. [[Backup and Restore]]. Do this on day one.
3. [[Using the Drive]]. Upload, find and get things back.
4. [[Sharing Files]] and [[Desktop App]]. The two things most people do next.

**Already running it**

- [[Updating]]
- [[Configuration]]
- [[Reverse Proxy]]. Reach your drive from outside the house, with HTTPS.
- [[Storage Check]]. When a file says it needs a check.
- [[Troubleshooting]]
- [[FAQ]]

**Your own settings**

- [[Your Account]]

**Running it for other people**

- [[User Management]]
- [[Admin Guide]]

## How it is built

Four parts work together. You only need this if something breaks.

| Part                  | What it does                                                 |
| --------------------- | ------------------------------------------------------------ |
| Web app               | The pages you click on.                                      |
| Worker                | A helper in the background. It makes previews and cleans up. |
| Database (PostgreSQL) | Remembers names, folders, people and share links.            |
| Storage folder        | Holds the real files on your disk.                           |

The database and the storage folder go together. Always back up both.

## Help and contact

- Questions and ideas: [GitHub Discussions](https://github.com/itsmeares/staaash/discussions)
- Bugs: [issue tracker](https://github.com/itsmeares/staaash/issues)
- Security problems, privately: [security policy](https://github.com/itsmeares/staaash/blob/main/.github/SECURITY.md)
- The code: https://github.com/itsmeares/staaash
