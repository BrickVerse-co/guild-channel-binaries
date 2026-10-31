import fs from "node:fs";
import path from "node:path";
import { app } from "electron";

export type PresenceSettings = {
	enabled: boolean;
	discordEnabled: boolean;
	detectGames: boolean;
	detectMusic: boolean;
	customEnabled: boolean;
	customName: string;
	customDetails: string;
	customState: string;
};

const defaults: PresenceSettings = {
	enabled: true,
	discordEnabled: true,
	detectGames: true,
	detectMusic: true,
	customEnabled: false,
	customName: "BrickVerse",
	customDetails: "",
	customState: "",
};

function filePath(): string {
	return path.join(app.getPath("userData"), "presence-settings.json");
}

export function loadPresenceSettings(): PresenceSettings {
	try {
		const parsed = JSON.parse(fs.readFileSync(filePath(), "utf8"));
		return sanitizePresenceSettings(parsed);
	} catch {
		return { ...defaults };
	}
}

export function sanitizePresenceSettings(value: any): PresenceSettings {
	return {
		enabled: value?.enabled !== false,
		discordEnabled: value?.discordEnabled !== false,
		detectGames: value?.detectGames === true,
		detectMusic: value?.detectMusic === true,
		customEnabled: value?.customEnabled === true,
		customName: typeof value?.customName === "string" ? value.customName.trim().slice(0, 100) || defaults.customName : defaults.customName,
		customDetails: typeof value?.customDetails === "string" ? value.customDetails.trim().slice(0, 128) : "",
		customState: typeof value?.customState === "string" ? value.customState.trim().slice(0, 128) : "",
	};
}

export function savePresenceSettings(value: any): PresenceSettings {
	const settings = sanitizePresenceSettings(value);
	fs.writeFileSync(filePath(), JSON.stringify(settings, null, 2), "utf8");
	return settings;
}
