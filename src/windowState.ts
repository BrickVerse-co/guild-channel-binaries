import fs from "node:fs";
import path from "node:path";
import { app, BrowserWindow } from "electron";

const STATE_FILE = path.join(app.getPath("userData"), "window-state.json");

export function loadState(): {
	width: number;
	height: number;
	isMaximized: boolean;
	x?: number;
	y?: number;
} {
	try {
		if (fs.existsSync(STATE_FILE)) {
			const raw = fs.readFileSync(STATE_FILE, "utf8");
			return JSON.parse(raw);
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
		const data = {
			...bounds,
			isMaximized: win.isMaximized(),
		};
		fs.writeFileSync(STATE_FILE, JSON.stringify(data, null, 2), "utf8");
	} catch (err) {
		console.error("Failed to save state:", err);
	}
}
