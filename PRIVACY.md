# SideStage Privacy Policy

Last updated: 17 November 2026

SideStage is an open-source Chrome extension for running a karaoke queue from Chrome's side panel. Its source code is available at https://github.com/ChiChou/sidestage. This policy explains what information SideStage handles and where it goes.

## Summary

SideStage has no developer-operated server, account system, analytics, or advertising SDK. It keeps your queue, singer names, settings, and imported media in your Chrome profile on your device. The extension does not send this information to the developer. Looking up video titles and playing YouTube videos sends requests directly from your browser to YouTube, as described below.

## Information SideStage handles

- **Queue and history.** The YouTube links, video titles, and local files you add, the songs you have sung, and their playback positions.
- **Singer names** that you type into the queue.
- **Settings**, such as language, break options, background volume, display choice, and panel look.
- **Local media files** you choose. SideStage copies them into the extension's storage in your browser so they can play in the player window. Your original files are never changed or deleted.
- **Tab information.** SideStage reads YouTube tab addresses and titles to let you queue videos and to control its player tab. Links and titles of videos you add are saved in your queue and song history. It does not maintain a general browsing-history database. Other YouTube tabs are muted while the controller panel is open; their previous mute state is not automatically restored when it closes.
- **Display information.** The names and positions of connected screens, used only to place the player window.

## Where it is stored

Queue entries, song history, singer names, settings, and playback positions are saved locally using Chrome's extension storage and local storage. Imported media copies are kept in IndexedDB. Player window and tab IDs and the active break are held in session storage. Connected display information is read to position the player; your selected display is saved as a setting.

Removing an entry does not delete your original media file. Cleanup removes the stored copy after it is no longer referenced by the queue, song history, break list, or active break. Uninstalling SideStage removes its browser-managed extension data.

## Connections to YouTube

To look up a video's title, SideStage sends the selected video ID in a request to YouTube's oEmbed service. If that fails, it requests the video's watch page with browser credentials enabled, which allows the browser to include applicable YouTube cookies, and reads the title from the response. SideStage does not read the cookies themselves.

Videos play on YouTube's website in a browser tab. YouTube receives the video requests and associated network information, such as your IP address, and may associate activity with your existing YouTube session. YouTube controls the requests made by its own website. These connections are governed by [Google's privacy policy](https://policies.google.com/privacy).

SideStage does not upload your imported media, singer names, or complete queue to YouTube. Individual video IDs are sent when looking up or playing those videos.

## Sharing

SideStage does not sell your information or send your queue, singer names, settings, or imported files to the developer. The developer does not receive extension usage data. Direct connections to YouTube for video title lookup and playback are described above.

## Children

The developer does not collect personal information through the extension, including information about children. YouTube's own data practices apply when its services are used.

## Changes

If a future version introduces a developer-operated service or changes what information is stored or sent, this policy will be updated before that version is released. The update will explain the new data flows and, where applicable, retention and deletion options.

Changes to this policy will be posted on this page with a new date.

## Contact

Questions or concerns: open an issue at https://github.com/ChiChou/sidestage/issues
