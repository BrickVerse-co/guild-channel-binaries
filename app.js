// (c) 2026 Meta Games LLC. All rights reserved.

require("dotenv/config");

const {
	app,
	BrowserWindow,
	shell,
	nativeImage,
	ipcMain,
	Tray,
} = require("electron");
// Tray icon for notifications (Windows/Linux)
let tray = null;
const path = require("node:path");
const fs = require("node:fs");
const DiscordRPC = require("discord-rpc");

const IS_DEV = process.env.NODE_ENV === "development";
const LOCAL_BASE_URL = "http://localhost:3000";
const LIVE_BASE_URL = "https://brickverse.gg";
let activeBaseUrl = IS_DEV ? LOCAL_BASE_URL : LIVE_BASE_URL;

const STATE_FILE = path.join(app.getPath("userData"), "window-state.json");

// Discord Rich Presence
const DISCORD_CLIENT_ID = "1493410322797826239";
let mainWindow = null;

let rpcClient = null;
let rpcReady = false;
let rpcActivityDebounce = null;
const rpcPresenceOverrides = new Map();
let rpcClientDestroyed = false;

function destroyRpcClient() {
	if (rpcClient && !rpcClientDestroyed) {
		try {
			rpcClient.destroy();
		} catch {
			// Ignore RPC shutdown errors during app close.
		}
		rpcClient = null;
		rpcClientDestroyed = true;
		logRpcDebug("RPC client destroyed on app quit");
	}
}

function logRpcDebug(message, extra) {
	if (typeof extra === "undefined") {
		console.log(`[BV][RPC] ${message}`);
		return;
	}

	console.log(`[BV][RPC] ${message}`, extra);
}

/**
 * Parses the window title and URL into Discord presence fields.
 * Title format from the frontend:
 *   In channel:  "(N) #channelName | GuildName | Brickverse"
 *   Guild root:  "GuildName | Brickverse"
 */
function parsePresenceFromPage(title, url) {
	// Strip leading notification count e.g. "(3) "
	const cleanTitle = title.replace(/^\(\d+\)\s*/, "");
	const parts = cleanTitle.split(" | ").map((s) => s.trim());

	// /guilds/:id/channels/:channelId — viewing a specific channel
	if (/\/guilds\/[^/]+\/channels\/[^/?#]+/.test(url)) {
		return {
			details: parts[0] ? `Viewing ${parts[0]}` : "Viewing a channel",
			state: parts[1] || "BrickVerse Guild",
		};
	}

	// /guilds/:id/channels — channel landing / setup
	if (/\/guilds\/[^/]+\/channels/.test(url)) {
		return {
			details: "Browsing channels",
			state: parts[0] || "BrickVerse Guild",
		};
	}

	return {
		details: "In BrickVerse",
		state: "Guild Channels",
	};
}

function sanitizePresenceText(value, fallback) {
	if (typeof value !== "string") return fallback;
	const trimmed = value.trim();
	if (!trimmed) return fallback;
	return trimmed.slice(0, 128);
}

function getPresenceOverride(win) {
	if (!win || win.isDestroyed()) return null;
	return rpcPresenceOverrides.get(win.webContents.id) || null;
}

function buildActivityFromWindow(win) {
	const override = getPresenceOverride(win);
	if (override) {
		return {
			details: sanitizePresenceText(override.details, "In BrickVerse"),
			state: sanitizePresenceText(override.state, "Guild Channels"),
			largeImageKey: "logo",
			largeImageText: "BrickVerse.gg",
			smallImageKey:
				typeof override.smallImageKey === "string"
					? override.smallImageKey
					: undefined,
			smallImageText:
				typeof override.smallImageText === "string"
					? sanitizePresenceText(override.smallImageText, "")
					: undefined,
			instance: false,
		};
	}

	const title = win.getTitle();
	const url = win.webContents.getURL();
	const { details, state } = parsePresenceFromPage(title, url);
	return {
		details,
		state,
		largeImageKey: "logo",
		largeImageText: "BrickVerse.gg",
		instance: false,
	};
}

function setRichPresenceOverride(win, payload) {
	if (!win || win.isDestroyed()) return;

	if (!payload || typeof payload !== "object") {
		rpcPresenceOverrides.delete(win.webContents.id);
		updateRpcActivity(win);
		return;
	}

	const nextOverride = {
		details: sanitizePresenceText(payload.details, "In BrickVerse"),
		state: sanitizePresenceText(payload.state, "Guild Channels"),
		smallImageKey:
			typeof payload.smallImageKey === "string" &&
			payload.smallImageKey.trim().length > 0
				? payload.smallImageKey.trim().slice(0, 32)
				: undefined,
		smallImageText:
			typeof payload.smallImageText === "string" &&
			payload.smallImageText.trim().length > 0
				? sanitizePresenceText(payload.smallImageText, "")
				: undefined,
	};

	rpcPresenceOverrides.set(win.webContents.id, nextOverride);
	updateRpcActivity(win);
}

function setupRpc() {
	if (!DISCORD_CLIENT_ID) {
		console.warn("[BV] DISCORD_CLIENT_ID not set — Rich Presence disabled");
		return;
	}

	DiscordRPC.register(DISCORD_CLIENT_ID);
	rpcClient = new DiscordRPC.Client({ transport: "ipc" });

	rpcClient.on("ready", () => {
		rpcReady = true;
		console.log("[BV] Discord RPC ready");
		updateRpcActivity(mainWindow);
	});

	rpcClient.on("disconnected", () => {
		rpcReady = false;
	});

	rpcClient.on("error", (err) => {
		console.warn("[BV] Discord RPC client error:", err?.message || err);
	});

	rpcClient.login({ clientId: DISCORD_CLIENT_ID }).catch((err) => {
		console.warn("[BV] Discord RPC login failed:", err.message);
	});
}

function updateRpcActivity(win) {
	if (!rpcReady || !rpcClient || !win || win.isDestroyed()) {
		return;
	}

	clearTimeout(rpcActivityDebounce);

	rpcActivityDebounce = setTimeout(() => {
		try {
			const activity = buildActivityFromWindow(win);

			rpcClient.setActivity(activity).catch((err) => {
				console.warn("[BV] Discord RPC setActivity failed:", err.message);
			});
		} catch (err) {
			console.warn("[BV] Discord RPC update error:", err.message);
		}
	}, 1000);
}

function getDefaultUrl() {
	return `${activeBaseUrl}/guilds/0/channels/landing`;
}

function getBaseMode() {
	return activeBaseUrl === LOCAL_BASE_URL ? "local" : "live";
}

function isInternalAppUrl(url) {
	return url.startsWith(LOCAL_BASE_URL) || url.startsWith(LIVE_BASE_URL);
}

function getSwitchedUrl(url) {
	const currentBase = url.startsWith(LOCAL_BASE_URL)
		? LOCAL_BASE_URL
		: url.startsWith(LIVE_BASE_URL)
			? LIVE_BASE_URL
			: null;

	const nextBase =
		activeBaseUrl === LOCAL_BASE_URL ? LIVE_BASE_URL : LOCAL_BASE_URL;

	if (!currentBase) {
		return `${nextBase}/guilds/0/channels/landing`;
	}

	return `${nextBase}${url.slice(currentBase.length)}`;
}

function switchBaseUrl(win) {
	if (!win || win.isDestroyed()) {
		return getBaseMode();
	}

	const currentUrl = win.webContents.getURL();
	const nextUrl = getSwitchedUrl(currentUrl);
	activeBaseUrl = nextUrl.startsWith(LOCAL_BASE_URL)
		? LOCAL_BASE_URL
		: LIVE_BASE_URL;
	win.loadURL(nextUrl);
	return getBaseMode();
}

function getIconPath() {
	if (process.platform === "win32") {
		return path.join(__dirname, "assets", "icon.ico");
	}

	if (process.platform === "darwin") {
		return path.join(__dirname, "assets", "icon.icns");
	}

	return path.join(__dirname, "assets", "icon.png");
}

function extractNotificationCount(title) {
	const match = title.match(/\((\d+)\)/);
	return match ? parseInt(match[1], 10) : 0;
}

function getNotificationIconPath(count) {
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

	// Windows icons use overlays on the pre-existing icons
	// so we only need the literal number icons.
	if (platform === "win32") {
		// if it's april 1st - 2nd we use the infinite symbol
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

function updateNotificationIcon(win) {
	if (!win || win.isDestroyed()) return;

	const title = win.getTitle();
	const count = extractNotificationCount(title);
	const iconPath = getNotificationIconPath(count);
	const image = nativeImage.createFromPath(iconPath);

	if (process.platform === "darwin") {
		app.dock.setIcon(image);
	} else {
		try {
			if (!tray) {
				tray = new Tray(image);
				tray.setToolTip("BrickVerse Guild Channels");
			} else {
				tray.setImage(image);
			}

			// Windows can use overlay icons as setIcon doesn't work
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
		width: 1280,
		height: 860,
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
		width: state.width || 1280,
		height: state.height || 860,
		minWidth: 960,
		minHeight: 640,
		x: Number.isFinite(state.x) ? state.x : undefined,
		y: Number.isFinite(state.y) ? state.y : undefined,
		show: false,
		frame: false,
		titleBarStyle: process.platform === "darwin" ? "hidden" : undefined,
		backgroundColor: "#313338",
		autoHideMenuBar: true,
		icon: nativeImage.createFromPath(iconPath),
		webPreferences: {
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: false,
			preload: path.join(__dirname, "preload.js"),
		},
	});

	if (app.isPackaged) {
		//	win.webContents.openDevTools({ mode: "detach" });
	}

	mainWindow = win;
	const webContentsId = win.webContents.id;

	win.on("closed", () => {
		rpcPresenceOverrides.delete(webContentsId);
		if (mainWindow === win) {
			mainWindow = null;
		}
	});

	if (state.isMaximized) {
		win.maximize();
	}

	win.once("ready-to-show", () => {
		win.show();
	});

	win.loadURL(getDefaultUrl());

	const persist = () => saveState(win);

	win.on("resize", persist);
	win.on("move", persist);
	win.on("maximize", persist);
	win.on("unmaximize", persist);
	win.on("close", persist);

	win.webContents.on("did-finish-load", () => {
		persist();
		updateNotificationIcon(win);
		updateRpcActivity(win);
	});

	win.webContents.on("did-navigate", () => {
		persist();
		updateNotificationIcon(win);
		updateRpcActivity(win);
	});

	win.webContents.on("did-redirect-navigation", () => {
		persist();
	});

	win.webContents.on("page-title-updated", () => {
		updateNotificationIcon(win);
		updateRpcActivity(win);
	});

	win.webContents.setWindowOpenHandler(({ url }) => {
		if (isInternalAppUrl(url)) {
			// Force same-window navigation instead of opening a new window
			setImmediate(() => win.loadURL(url));
		} else {
			shell.openExternal(url);
		}

		return { action: "deny" };
	});

	win.webContents.on("will-navigate", (event, url) => {
		const sameSite = isInternalAppUrl(url);

		if (!sameSite) {
			event.preventDefault();
			shell.openExternal(url);
		}
	});

	updateNotificationIcon(win);

	return win;
}

function handleWindowControl(event, action) {
	const win = BrowserWindow.fromWebContents(event.sender);
	if (!win || win.isDestroyed()) return false;

	switch (action) {
		case "minimize":
			win.minimize();
			return true;
		case "toggle-base-url":
			return switchBaseUrl(win);
		case "get-base-url-mode":
			return getBaseMode();
		case "toggle-maximize":
			if (win.isMaximized()) {
				win.unmaximize();
				return false;
			}

			win.maximize();
			return true;
		case "is-maximized":
			return win.isMaximized();
		case "close":
			win.close();
			return true;
		default:
			throw new Error(`Unknown window control action: ${action}`);
	}
}

ipcMain.handle("bv-window-control", handleWindowControl);

ipcMain.handle("bv-window-minimize", (event) => {
	return handleWindowControl(event, "minimize");
});

ipcMain.handle("bv-window-toggle-maximize", (event) => {
	return handleWindowControl(event, "toggle-maximize");
});

ipcMain.handle("bv-window-is-maximized", (event) => {
	return handleWindowControl(event, "is-maximized");
});

ipcMain.handle("bv-window-close", (event) => {
	return handleWindowControl(event, "close");
});

ipcMain.handle("bv-set-rich-presence-context", (event, payload) => {
	const win = BrowserWindow.fromWebContents(event.sender);
	if (!win || win.isDestroyed()) return false;
	setRichPresenceOverride(win, payload);
	return true;
});

app.whenReady().then(() => {
	if (process.platform === "win32") {
		app.setAppUserModelId("gg.brickverse.guildchannels");
	}

	setupRpc();
	createWindow();

	app.on("activate", () => {
		if (BrowserWindow.getAllWindows().length === 0) {
			createWindow();
		}
	});
});

app.on("window-all-closed", () => {
	clearTimeout(rpcActivityDebounce);
	rpcActivityDebounce = null;
	destroyRpcClient();
	if (tray) {
		tray.destroy();
		tray = null;
	}
	if (process.platform !== "darwin") {
		app.quit();
	}
});

// Ensure RPC is destroyed on all app quit events (including task kill, SIGINT, etc)
app.on("quit", () => {
	destroyRpcClient();
});
