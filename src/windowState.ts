import fs from "node:fs";
import path from "node:path";
import { app, BrowserWindow } from "electron";

const STATE_FILE = path.join(app.getPath("userData"), "window-state.json");
let rememberedGuildUrl: string | undefined;

export function loadState(): {
	width: number;
	height: number;
	isMaximized: boolean;
	x?: number;
	y?: number;
	lastGuildUrl?: string;
} {
	try {
		if (fs.existsSync(STATE_FILE)) {
			const raw = fs.readFileSync(STATE_FILE, "utf8");
			const state = JSON.parse(raw);
			rememberedGuildUrl = state.lastGuildUrl;
			return state;
		}
	} catch (err) {
		console.error("Failed to load state:", err);
	}
    
	return {
		width: 1280,
		height: 860,
		isMaximized: false,
	};
}

export function saveState(win: BrowserWindow) {
	if (!win || win.isDestroyed()) return;
	try {
		const bounds = win.getBounds();
		rememberedGuildUrl = getGuildUrl(win.webContents.getURL()) || rememberedGuildUrl;
		const data = {
			...bounds,
			isMaximized: win.isMaximized(),
			...(rememberedGuildUrl
				? { lastGuildUrl: rememberedGuildUrl }
				: {}),
		};
		fs.writeFileSync(STATE_FILE, JSON.stringify(data, null, 2), "utf8");
	} catch (err) {
		console.error("Failed to save state:", err);
	}
}

function getGuildUrl(value: string): string | undefined {
	try {
		const url = new URL(value);
		return /^\/guilds\/[^/]+\/channels\/[^/]+(?:\/.*)?$/.test(url.pathname)
			? `${url.pathname}${url.search}${url.hash}`
			: undefined;
	} catch {
		return undefined;
	}
}
