// (c) 2026 Meta Games LLC. All rights reserved.

require("dotenv/config");

const { app, BrowserWindow, shell, nativeImage } = require("electron");
const path = require("node:path");
const fs = require("node:fs");

const IS_DEV = process.env.NODE_ENV === "development";
const BASE_URL = IS_DEV ? "http://localhost:3000" : "https://brickverse.gg";

console.log(`Starting app in ${IS_DEV ? "development" : "production"} mode...`);

const DEFAULT_URL = `${BASE_URL}/guild-channels-hero`;
const STATE_FILE = path.join(app.getPath("userData"), "window-state.json");

console.log("User data path:", app.getPath("userData"));
console.log("Launching URL:", DEFAULT_URL);

function getIconPath() {
	if (process.platform === "win32") {
		return path.join(__dirname, "assets", "icon.ico");
	}

	if (process.platform === "darwin") {
		return path.join(__dirname, "assets", "icon.icns");
	}

	return path.join(__dirname, "assets", "icon.png");
}

function loadState() {
	try {
		if (fs.existsSync(STATE_FILE)) {
			const raw = fs.readFileSync(STATE_FILE, "utf8");
			return JSON.parse(raw);
		}
	} catch (err) {
		console.error("Failed to load state:", err);
	}

	return {
		width: 1200,
		height: 800,
		lastUrl: DEFAULT_URL,
		isMaximized: false,
	};
}

function saveState(win) {
	if (!win || win.isDestroyed()) return;

	try {
		const bounds = win.getBounds();
		const data = {
			...bounds,
			isMaximized: win.isMaximized(),
			lastUrl: win.webContents.getURL() || DEFAULT_URL,
		};

		fs.writeFileSync(STATE_FILE, JSON.stringify(data, null, 2), "utf8");
	} catch (err) {
		console.error("Failed to save state:", err);
	}
}

function createWindow() {
	const state = loadState();
	const iconPath = getIconPath();

	const win = new BrowserWindow({
		width: state.width || 1200,
		height: state.height || 800,
		x: Number.isFinite(state.x) ? state.x : undefined,
		y: Number.isFinite(state.y) ? state.y : undefined,
		show: false,
		backgroundColor: "#313338",
		autoHideMenuBar: true,
		icon: nativeImage.createFromPath(iconPath),
		webPreferences: {
			contextIsolation: true,
			nodeIntegration: false,
			// No partition set = default persistent session
		},
	});

	if (state.isMaximized) {
		win.maximize();
	}

	win.once("ready-to-show", () => {
		win.show();
	});

	win.loadURL(state.lastUrl || DEFAULT_URL);

	const persist = () => saveState(win);

	win.on("resize", persist);
	win.on("move", persist);
	win.on("maximize", persist);
	win.on("unmaximize", persist);
	win.on("close", persist);

	win.webContents.on("did-navigate", persist);
	win.webContents.on("did-redirect-navigation", persist);

	// Open external links in the normal browser.
	win.webContents.setWindowOpenHandler(({ url }) => {
		const sameSite = url.startsWith(BASE_URL);
		if (!sameSite) {
			shell.openExternal(url);
			return { action: "deny" };
		}
		return { action: "allow" };
	});

	return win;
}

app.whenReady().then(() => {
	createWindow();

	app.on("activate", () => {
		if (BrowserWindow.getAllWindows().length === 0) {
			createWindow();
		}
	});
});

app.on("window-all-closed", () => {
	// Standard Electron macOS behavior:
	// keep app alive until user quits explicitly
	if (process.platform !== "darwin") {
		app.quit();
	}
});