import { autoUpdater } from "electron-updater";
import { dialog, BrowserWindow } from "electron";

export function setupAutoUpdater(win: BrowserWindow) {
	autoUpdater.autoDownload = false;
	autoUpdater.on("update-available", (info) => {
		dialog
			.showMessageBox(win, {
				type: "info",
				title: "Update Available",
				message: `A new version (${info.version}) is available. Do you want to download and install it?`,
				buttons: ["Yes", "Later"],
			})
			.then((result) => {
				if (result.response === 0) {
					autoUpdater.downloadUpdate();
				}
			});
	});
    
	autoUpdater.on("update-downloaded", () => {
		dialog
			.showMessageBox(win, {
				type: "info",
				title: "Update Ready",
				message:
					"Update downloaded. The app will now restart to apply the update.",
				buttons: ["Restart"],
			})
			.then(() => {
				autoUpdater.quitAndInstall();
			});
	});

	autoUpdater.on("error", (err) => {
		dialog.showErrorBox(
			"Update Error",
			err == null ? "unknown" : (err.stack || err).toString(),
		);
	});
}

export function checkForUpdates() {
	autoUpdater.checkForUpdates();
}
