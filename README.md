# BrickVerse Guild Channels – Electron Client

A lightweight Electron desktop wrapper for the BrickVerse Guild Channels UI, providing a simple Chromium-based experience outside the browser.

This client allows you to run Guild Channels as a standalone desktop app, with features like app icons/notification indicators similar to apps like Discord.

Tagged releases automatically publish installer-managed ZIP builds for Windows,
macOS, and Linux. Application updates are handled by BrickVerse Installer.

When BrickVerse Client or Creator is running, Guild Chat listens on a loopback-only
presence relay and mirrors the same activity sent to Discord into BrickVerse rich
presence for the currently signed-in user.

The reusable SDK lives in [`sdk/`](sdk/). It supports JavaScript/Node via
`index.js` and C# via `BrickVerseRichPresence.cs`, so games can integrate without
depending on Discord’s SDK.

With Guild Chat running and signed in, preview the relay with:

```powershell
npm run demo:presence-relay
```


> Note: This is purely a convenience wrapper. All functionality is available directly on the web, and this client is not required to use Guild Channels.

---

## Disclaimer

This software is licensed under the Apache 2.0 License.

The BrickVerse name, logo, branding, and all assets within the `assets/` directory remain the intellectual property of Meta Games LLC.
