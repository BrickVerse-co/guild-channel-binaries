import fs from "node:fs";
import path from "node:path";
import { app } from "electron";

export type DesktopSettings = {
	launchAtLogin: boolean;
	closeToTray: boolean;
	notificationsEnabled: boolean;
	flashTaskbar: boolean;
};

const defaults: DesktopSettings = {
	launchAtLogin: false,
	closeToTray: true,
	notificationsEnabled: true,
	flashTaskbar: true,
};

function filePath(): string {
	return path.join(app.getPath("userData"), "desktop-settings.json");
}

export function loadDesktopSettings(): DesktopSettings {
	try {
		const value = JSON.parse(fs.readFileSync(filePath(), "utf8"));
		return {
			launchAtLogin: value?.launchAtLogin === true,
			closeToTray: value?.closeToTray !== false,
			notificationsEnabled: value?.notificationsEnabled !== false,
			flashTaskbar: value?.flashTaskbar !== false,
		};
	} catch {
		return { ...defaults };
	}
}

export function saveDesktopSettings(value: unknown): DesktopSettings {
	const candidate = value as Partial<DesktopSettings> | null;
	const settings = {
		launchAtLogin: candidate?.launchAtLogin === true,
		closeToTray: candidate?.closeToTray !== false,
		notificationsEnabled: candidate?.notificationsEnabled !== false,
		flashTaskbar: candidate?.flashTaskbar !== false,
	};
	fs.writeFileSync(filePath(), JSON.stringify(settings, null, 2), "utf8");
	return settings;
}
