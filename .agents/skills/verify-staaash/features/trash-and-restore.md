# Trash and restore

An owner can move a folder or file to Trash, find it there, and restore it to
its original location.

## Sub-features

- `trash-move` moves an item out of Files.
- `trash-list` shows the item in `/trash`.
- `trash-restore` restores the item.
- `trash-return` shows it in its original location again.

## How to get to it (user POV)

- Create or upload an item in Files.
- Open the item's action menu and choose `Move to trash`.
- Choose `Trash` in the Drive navigation.
- Choose the item's `Restore` action.

## Driving it with Playwright

Preconditions:

- A fake folder or file exists in Files.
- No other run's item is used as the fixture.

- **Move it.** Open the item action menu and choose `Move to trash`. The item leaves the Files list.
- **Find it.** Open `/trash`. The item name is visible.
- **Restore it.** Choose the button named `Restore <item name>`. The item leaves Trash.
- **Confirm the return.** Open its original Files location. The item name is visible again.

## Gotchas

- Empty Trash is destructive. Do not use it for a normal restore check.
- A folder restore can bring back its whole tree. Check the parent path as well as the name.
- Do not use a direct database update or storage command to create the trash state.
- If the worker is not ready, stop and fix the demo before testing storage changes.
