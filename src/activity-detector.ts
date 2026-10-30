import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { PresenceSettings } from "./presence-settings";

const execFileAsync = promisify(execFile);
const GAMES: Array<[RegExp, string]> = [
	[/^(minecraft|javaw)$/i, "Minecraft"],
	[/^(fortniteclient-win64-shipping)$/i, "Fortnite"],
	[/^(valorant-win64-shipping)$/i, "VALORANT"],
	[/^(league of legends)$/i, "League of Legends"],
	[/^(gta5|rdr2)$/i, "Rockstar Games"],
	[/^(overwatch|overwatch launcher)$/i, "Overwatch"],
	[/^cs2$/i, "Counter-Strike 2"],
	[/^dota2$/i, "Dota 2"],
	[/^eldenring$/i, "Elden Ring"],
	[/^robloxplayerbeta$/i, "Roblox"],
];
const GAME_PATH = /[\\/](steamapps[\\/]common|epic games|gog games|xboxgames|riot games|ea games|ubisoft)[\\/]/i;
const NON_GAMES = /^(steam|steamwebhelper|epicgameslauncher|galaxyclient|riotclientservices|eadesktop|upc|ubisoftconnect|crashhandler|unins)/i;

export type DetectedActivity = {
	activityType: "GAME" | "MUSIC" | "CUSTOM";
	source: "desktop-detector" | "custom";
	applicationName: string;
	details?: string;
	state?: string;
	assets?: { largeImage?: string; largeText?: string };
	ttlSeconds: number;
	metadataQuery?: string;
};

async function windowsProcesses(): Promise<
	Array<{ name: string; title: string; path: string }>
> {
	if (process.platform !== "win32") return [];
	const script =
		"Get-Process | Where-Object {$_.MainWindowTitle} | Select-Object ProcessName,MainWindowTitle,Path | ConvertTo-Json -Compress";
	const { stdout } = await execFileAsync(
		"powershell.exe",
		["-NoProfile", "-NonInteractive", "-Command", script],
		{ timeout: 8000, windowsHide: true, maxBuffer: 1024 * 1024 },
	);
	const parsed = JSON.parse(stdout || "[]");
	return (Array.isArray(parsed) ? parsed : [parsed]).map((item: any) => ({
		name: String(item.ProcessName || ""),
		title: String(item.MainWindowTitle || ""),
		path: String(item.Path || ""),
	}));
}

function gameNameFromProcess(processInfo: { name: string; title: string; path: string }): string | null {
	const known = GAMES.find(([pattern]) => pattern.test(processInfo.name));
	if (known) return known[1];
	if (!GAME_PATH.test(processInfo.path) || NON_GAMES.test(processInfo.name)) return null;
	const pathParts = processInfo.path.split(/[\\/]/).filter(Boolean);
	const commonIndex = pathParts.findIndex((part) => /^(common|epic games|gog games|xboxgames|riot games|ea games|ubisoft)$/i.test(part));
	const folderName = commonIndex >= 0 ? pathParts[commonIndex + 1] : "";
	const title = processInfo.title.replace(/\s+[-–—]\s+(DirectX\s*\d+|Vulkan|OpenGL)$/i, "").trim();
	return (folderName || title || processInfo.name).replace(/[_-]+/g, " ").trim().slice(0, 100) || null;
}

export async function detectActivity(
	settings: PresenceSettings,
): Promise<DetectedActivity | null> {
	if (!settings.enabled) return null;
	if (settings.customEnabled)
		return {
			activityType: "CUSTOM",
			source: "custom",
			applicationName: settings.customName,
			details: settings.customDetails || undefined,
			state: settings.customState || undefined,
			ttlSeconds: 90,
		};
	if (!settings.detectGames && !settings.detectMusic) return null;
	try {
		const processes = await windowsProcesses();
		if (settings.detectMusic) {
			const spotify = processes.find(
				(item) =>
					item.name.toLowerCase() === "spotify" &&
					item.title &&
					item.title.toLowerCase() !== "spotify",
			);
			if (spotify)
				return {
					activityType: "MUSIC",
					source: "desktop-detector",
					applicationName: "Spotify",
					details: spotify.title,
					state: "Listening on Spotify",
					ttlSeconds: 90,
					metadataQuery: spotify.title,
				};
		}
		if (settings.detectGames) {
			for (const processInfo of processes) {
				const gameName = gameNameFromProcess(processInfo);
				if (gameName)
					return {
						activityType: "GAME",
						source: "desktop-detector",
						applicationName: gameName,
						details: `Playing ${gameName}`,
						ttlSeconds: 90,
						metadataQuery: gameName,
					};
			}
		}
	} catch (error) {
		console.warn("[BV][Presence] Activity detection failed:", error);
	}
	return null;
}
