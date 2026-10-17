# Desktop build

The Steam version is the release build of the game (`npm run build:release`,
written to `dist-release/`) inside an Electron window.

```sh
npm run desktop       # build the release game and open it in Electron
npm run desktop:pack  # build unpacked Windows and Linux folders in release/
```

`desktop:pack` produces `release/win-unpacked/` and `release/linux-unpacked/`.
Those folders are what gets uploaded to Steam as depots; Steam's own installer
replaces a setup program.

## Saves

The game's storage (`src/engine/store.ts`) becomes one JSON file per key in
the save folder:

| System | Folder |
| --- | --- |
| Windows | `%APPDATA%\The Silent Bells\saves` |
| Linux, Steam Deck | `~/.config/The Silent Bells/saves` |
| macOS | `~/Library/Application Support/The Silent Bells/saves` |

Each hero is `orsolya.hero.<id>.json`; options are `arpg.settings.json`.
Writes go to a temporary file first and are then swapped in, and the previous
version is kept as `.bak`, which is read if the main file is damaged.

## Steam Cloud

Use Steam Auto-Cloud (Steamworks, App Admin, Cloud), with one root per system:

| Root | Subdirectory | Pattern |
| --- | --- | --- |
| `WinAppDataRoaming` | `The Silent Bells/saves` | `*.json` |
| `LinuxXdgConfigHome` | `The Silent Bells/saves` | `*.json` |

Add a root override so Linux and Steam Deck share Windows saves. The game
needs no Steamworks SDK for this.

## Still to do before release

- A real app icon (the default Electron icon is a placeholder).
- A macOS build needs signing and notarising on a Mac.
