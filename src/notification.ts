import { app, nativeImage, Tray, BrowserWindow } from "electron";
import path from "node:path";
import fs from "node:fs";

export function getIconPath(): string {
	if (process.platform === "win32") {
		return path.join(__dirname, "../assets/icon.ico");
	}
	if (process.platform === "darwin") {
		return path.join(__dirname, "../assets/icon.icns");
	}
	return path.join(__dirname, "../assets/icon.png");
}

export function extractNotificationCount(title: string): number {
	const match = title.match(/\((\d+)\)/);
	return match ? parseInt(match[1], 10) : 0;
}

export function getNotificationIconPath(count: number): string {
	const appPath = app.isPackaged ? process.resourcesPath : app.getAppPath();
	const platform = process.platform;
	const assetsPath = app.isPackaged
		? path.join(appPath, "app.asar.unpacked", "assets", "pings")
		: path.join(appPath, "assets", "pings");
	let fileName = "unread.png";
	if (count >= 1 && count <= 9) {
		fileName = `${count}.png`;
	} else if (count > 9) {
		fileName = "9_or_more.png";
	}
	if (platform === "win32") {
		const now = new Date();
		if (now.getMonth() === 3 && (now.getDate() === 1 || now.getDate() === 2)) {
			fileName = "win_infinite.png";
		} else {
			fileName = `win_${fileName}`;
		}
	}
	const fullPath = path.join(assetsPath, fileName);
	if (!fs.existsSync(fullPath)) {
		console.warn(`[BV] Icon not found, falling back: ${fullPath}`);
		return getIconPath();
	}
	return fullPath;
}

export function updateNotificationIcon(win: BrowserWindow) {
	if (!win || win.isDestroyed()) return;
	const title = win.getTitle();
	const count = extractNotificationCount(title);
	const iconPath = getNotificationIconPath(count);
	const image = nativeImage.createFromPath(iconPath);

	if (process.platform === "darwin") {
		if (app && app.dock) app.dock.setIcon(image);
	} else {
		try {
			// Tray is managed in main.ts
			if (process.platform === "win32") {
				win.setOverlayIcon(
					nativeImage.createFromPath(iconPath),
					"Notifications",
				);
			} else {
				win.setIcon(image);
			}
		} catch (e) {
			console.error("[BV] Tray/Icon Error:", e);
		}
	}
}
