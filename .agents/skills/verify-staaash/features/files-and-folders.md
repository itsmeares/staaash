# Files and folders

An owner can create a folder and upload a fake file from the Files page, then
see the saved item after a reload.

## Sub-features

- `folder-create` opens New and saves a folder.
- `folder-reload` finds the folder after a page reload.
- `file-upload` sends a fake file through Upload files.
- `file-visible` shows the uploaded file in the chosen folder.

## How to get to it (user POV)

- Sign in and open Files.
- Choose `New`, then `New folder`.
- Choose `New`, then `Upload files`.
- Open the created folder to see its contents.

## Driving it with Playwright

Preconditions:

- The owner has completed first-run setup.
- The folder and file names are new for this run.

- **Create a folder.** Click `New`, choose the `New folder` menu item, fill `New folder name`, and press Enter. The folder name appears in the file list.
- **Confirm the folder.** Reload `/files`. The same folder name remains visible.
- **Upload a file.** Open the folder, click `New`, choose `Upload files`, wait for the file chooser, and set a small fake text file. The file name appears in the folder list.
- **Confirm the file.** Reload the folder page. The file name and size remain visible.

## Gotchas

- Use a new file name for each run.
- Use the file chooser opened by `Upload files`. Do not call the upload API as a substitute for the user action.
- The folder and file must be checked after the request settles and after a reload.
- The worker must be ready before testing an upload path.
