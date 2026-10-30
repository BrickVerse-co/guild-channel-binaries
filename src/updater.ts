import { app, BrowserWindow, dialog } from "electron";
import { autoUpdater, UpdateInfo } from "electron-updater";

export type UpdateState = {
	status: "idle" | "checking" | "available" | "not-available" | "downloading" | "downloaded" | "error";
	version?: string;
	percent?: number;
	message?: string;
};

let state: UpdateState = { status: "idle" };
let configured = false;

function publish(next: UpdateState): UpdateState {
	state = next;
	for (const win of BrowserWindow.getAllWindows()) {
		if (!win.isDestroyed()) win.webContents.send("bv-update-state", state);
	}
	return state;
}

export function getUpdateState(): UpdateState {
	return state;
}

export function configureUpdater(): void {
	if (configured || !app.isPackaged) return;
	configured = true;
	autoUpdater.autoDownload = true;
	autoUpdater.autoInstallOnAppQuit = true;
	autoUpdater.allowPrerelease = false;
	autoUpdater.on("checking-for-update", () => publish({ status: "checking" }));
	autoUpdater.on("update-available", (info: UpdateInfo) =>
		publish({ status: "available", version: info.version }),
	);
	autoUpdater.on("update-not-available", (info: UpdateInfo) =>
		publish({ status: "not-available", version: info.version }),
	);
	autoUpdater.on("download-progress", (progress) =>
		publish({
			status: "downloading",
			percent: Math.round(progress.percent),
			message: `${Math.round(progress.transferred / 1024 / 1024)} / ${Math.round(progress.total / 1024 / 1024)} MB`,
		}),
	);
	autoUpdater.on("update-downloaded", (info: UpdateInfo) =>
		publish({ status: "downloaded", version: info.version }),
	);
	autoUpdater.on("error", (error) =>
		publish({ status: "error", message: error.message }),
	);
}

export async function checkForUpdates(manual = false): Promise<UpdateState> {
	if (!app.isPackaged) {
		return publish({ status: "not-available", message: "Updates are disabled in development builds." });
	}
	configureUpdater();
	try {
		await autoUpdater.checkForUpdates();
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		publish({ status: "error", message });
		if (manual) await dialog.showMessageBox({ type: "error", title: "Update failed", message: "BrickVerse could not check for updates.", detail: message });
	}
	return state;
}

export function installUpdate(): boolean {
	if (state.status !== "downloaded") return false;
	setImmediate(() => autoUpdater.quitAndInstall(false, true));
	return true;
}
