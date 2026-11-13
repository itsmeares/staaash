# Desktop App

The desktop app keeps folders on your computer in step with folders in your drive. It lives in the tray, near the clock. A file you save in a synced folder goes to your drive. A file that changes in your drive comes to your computer.

It needs a Staaash server version 2.0 or newer.

## Download

Open the [releases page](https://github.com/itsmeares/staaash/releases), pick the newest release, and download the file for your system from **Assets**:

| System  | File                                            |
| ------- | ----------------------------------------------- |
| Windows | `.exe` installer (x64 or ARM64)                 |
| macOS   | `.dmg` (one file for Intel and Apple chips)     |
| Linux   | `.AppImage`, `.deb` or `.rpm` (x86_64 or ARM64) |

The installers are not code signed yet, so your computer may stop the first launch:

- **Windows:** if you see "Windows protected your PC", press **More info**, then **Run anyway**.
- **macOS:** open **System Settings**, then **Privacy & Security**, and press **Open Anyway**.

## Connect to your drive

1. Open the app and type your **Server address**, for example `drive.example.com`.
2. Press **Sign in with browser**, and approve this computer in the browser that opens.
3. Pick the folders to sync.

## Pick a sync mode

- **Two-way.** Changes go both ways.
- **Download only.** Your computer gets what is in the drive. Nothing goes back.
- **Upload only.** Your computer sends files up. Nothing comes down.

Under **Files to skip** you can leave out names you do not want to sync. Use the tray menu to pause for 1 hour, 1 day, 1 week, or until you resume. The settings also have limits for upload and download speed and for free space on your computer.

## Updates

On Windows and Linux, the app downloads new versions by itself. It installs one when you quit the app, or right away when you press **Restart to update**. On macOS, the app tells you a new version exists, and **Download** opens its release page.

In the app's settings, under **Updates**:

- **Check now** looks for a new version right away.
- **Channel** picks which releases to follow. **Automatic** follows release candidates only while you run one, so a test version moves back to stable releases once the stable one is out. **Stable** never offers release candidates. **Release candidates** always offers them.

If the app will not connect, check the address and read [[Troubleshooting]].
