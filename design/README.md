# Staaash brand kit

Logos, colors, and screenshots for writing about Staaash. You may use them to
link to, review, or write about the project.

## Name

Write **Staaash**: one capital S and three a's. Not "Stash", "STAAASH", or
"staaash".

- **One line:** The drive for your homelab.
- **Short:** Staaash is a self-hosted file drive with desktop sync.
- **Longer:** Staaash is a drive you run yourself. Your photos, documents, and
  music live on your own disk, and you reach them from a browser, a desktop app
  that syncs folders, or a share link. It runs from one Docker Compose file with
  PostgreSQL and a disk.

## Logo

| File                                                                | Use                                |
| ------------------------------------------------------------------- | ---------------------------------- |
| [Logo/Staaash Logo-Light](Logo/Staaash%20Logo-Light.svg) (SVG, PNG) | The mark and name on light colors. |
| [Logo/Staaash Logo-Dark](Logo/Staaash%20Logo-Dark.svg) (SVG, PNG)   | The mark and name on dark colors.  |
| [App/Staaash App Icon](App/Staaash%20App%20Icon.svg)                | The app icon on a dark tile.       |
| [App/Staaash App Icon-White](App/Staaash%20App%20Icon-White.svg)    | The app icon on a light tile.      |
| [Favicon/Staaash Favicon](Favicon/Staaash%20Favicon.svg)            | The mark alone, at small sizes.    |

Keep space around the logo at least as wide as the mark's blue light. Do not
recolor, stretch, rotate, or outline it, and do not change the name's font.

## Banner

[Banner/Staaash Banner-Dark.jpg](Banner/Staaash%20Banner-Dark.jpg) and
[Banner/Staaash Banner-Light.jpg](Banner/Staaash%20Banner-Light.jpg) are
2560 x 1280. They head the README and serve as the repository's social preview.

## Launch video

[Video/Staaash 2.0 Thumbnail.jpg](Video/Staaash%202.0%20Thumbnail.jpg) is the
1280 x 720 thumbnail of the Staaash 2.0 launch video.

## Colors

| Name                      | Dark theme | Light theme |
| ------------------------- | ---------- | ----------- |
| Background                | `#090807`  | `#f6f4f2`   |
| Surface                   | `#11100e`  | `#fefefd`   |
| Text                      | `#efeeec`  | `#1d1a17`   |
| Muted text                | `#a4a19d`  | `#64605b`   |
| Accent (buttons, links)   | `#d5ac76`  | `#8d5d24`   |
| Drive light (in the mark) | `#4a90ff`  | `#4a90ff`   |

The app defines these in OKLCH in `packages/ui/styles/tokens.css`. The hex values
here are close conversions for tools that need hex.

## Type

- **Headings and the name:** Cabinet Grotesk by the Indian Type Foundry, free from
  [Fontshare](https://www.fontshare.com/fonts/cabinet-grotesk).
- **Text:** Switzer, free from [Fontshare](https://www.fontshare.com/fonts/switzer).
- **Code:** JetBrains Mono, under the SIL Open Font License.

## Screenshots

`Screenshots/` holds each screen in a dark and a light version, taken from a
demo drive with made-up people and files. Every photo in it is public domain.

| Screen        | Shows                                         |
| ------------- | --------------------------------------------- |
| `home`        | Home with recent files, pins, and share links |
| `lisbon`      | A trip folder with photos and a video         |
| `photo`       | A photo open in the viewer                    |
| `video`       | A video playing in the viewer                 |
| `pdf`         | A PDF open in the viewer                      |
| `audio`       | A recording playing                           |
| `search`      | Search results while typing                   |
| `share`       | A shared folder as a visitor sees it          |
| `share-phone` | The same shared folder on a phone             |
| `members`     | The owner's list of family members            |
| `desktop`     | The desktop app syncing folders               |

The `-crop` files are tighter cuts of `search`, `members` and `share-phone`
for the README.
