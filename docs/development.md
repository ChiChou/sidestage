# Development

[Back to SideStage](../README.md)

Run these commands from a clone of the repository.

Use Node.js **22.18 or later** and npm.

```sh
cd dashboard
npm ci
npm test
npm run lint
npm run build
```

The build writes the panel, local-media player, assets, translations, and license
notices into `extension/`. Those generated files are ignored by git, except the
`_locales/` translations; only the hand-written extension files are tracked.
Reload the unpacked extension afterward.
`npm run dev` alone does not provide the Chrome extension APIs.

| Location | Purpose |
| --- | --- |
| `dashboard/src/App.tsx` | Side-panel interface |
| `dashboard/src/lib/dj.ts` | Queue, playback, persistence, and browser events |
| `dashboard/src/lib/ownership.ts` | Exclusive controller and media-operation locks |
| `dashboard/src/lib/idb.ts` | Local-media storage |
| `dashboard/src/MediaApp.tsx` | Player for local files |
| `extension/_locales/*/messages.json` | English, Chinese, Italian, and Spanish strings (Chrome i18n format, also the source of the dashboard's string types) |
| `extension/background.js` | Toolbar behavior, shortcuts, and translation messages |
| `extension/content-queue.js` | Queue buttons on YouTube pages |

Tests cover controller ownership, media cleanup/import failures, transaction
completion, and shortcut handling. Real Chrome testing is still needed for
display placement, autoplay, and compatibility with YouTube.

For loading the build in Chrome, see [Install](user-guide.md#install).

## Storage and permissions

Queue entries, singer names, settings, and bridge positions are saved in Chrome
extension storage. Imported media files are copied into IndexedDB in your browser
profile; removing an entry does not delete the original file on disk.

Cleanup deletes stored copies only after they are no longer referenced by a queue,
history entry, bridge list, or active bridge. Imports and cleanup are serialized.
Unused files left by an interrupted session are checked again when a controller
starts. Uninstalling the extension removes its browser-managed data.

The extension uses:

- `tabs` and YouTube host access to find videos, control the player, and mute tabs.
- `scripting` to communicate with the YouTube player.
- `storage` for queue/settings persistence.
- `sidePanel` for the console.
- `system.display` to place the player on a selected screen.

The application has no analytics or application backend. YouTube requests,
including title lookups, go to YouTube and are subject to its policies.
Local files are read by extension pages and are not uploaded by SideStage.
