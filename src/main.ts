import {
	app,
	BrowserWindow,
	shell,
	nativeImage,
	ipcMain,
	Tray,
} from "electron";
import path from "node:path";
import {
	setupRpc,
	destroyRpcClient,
	updateRpcActivity,
	setRichPresenceOverride,
} from "./rpc";
import { getIconPath, updateNotificationIcon } from "./notification";
import { loadState, saveState } from "./windowState";
import { checkForUpdates } from "./updater";

let rpcEnabled = true;
ipcMain.handle("bv-open-devtools", (event) => {
	const win = BrowserWindow.fromWebContents(event.sender);
	if (win && !win.isDestroyed()) {
		win.webContents.openDevTools({ mode: "detach" });
		return true;
	}
	return false;
});

ipcMain.handle("bv-set-rpc-enabled", (event, enabled: boolean) => {
	rpcEnabled = !!enabled;
	// Optionally: destroy or re-init RPC client here
	return rpcEnabled;
});

ipcMain.handle("bv-get-about-info", async () => {
	const electron = process.versions.electron;
	const chrome = process.versions.chrome;
	const node = process.versions.node;
	const v8 = process.versions.v8;
	let version = "unknown";
	try {
		// Try to read from package.json
		const pkg = require("../package.json");
		version = pkg.version || version;
	} catch {}
	return {
		version,
		electron,
		chrome,
		node,
		v8,
		platform: process.platform,
		arch: process.arch,
	};
});

const IS_DEV = process.env.NODE_ENV === "development";
const LOCAL_BASE_URL = "http://localhost:3000";
const LIVE_BASE_URL = "https://brickverse.gg";
let activeBaseUrl = IS_DEV ? LOCAL_BASE_URL : LIVE_BASE_URL;

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

function getDefaultUrl(): string {
	return `${activeBaseUrl}/guilds/0/channels/landing`;
}

function getBaseMode(): "local" | "live" {
	return activeBaseUrl === LOCAL_BASE_URL ? "local" : "live";
}

function isInternalAppUrl(url: string): boolean {
	return url.startsWith(LOCAL_BASE_URL) || url.startsWith(LIVE_BASE_URL);
}

function getSwitchedUrl(url: string): string {
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

function switchBaseUrl(win: BrowserWindow | null): "local" | "live" {
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

function createWindow(): BrowserWindow {
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

	mainWindow = win;
	win.on("closed", () => {
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
			setImmediate(() => win.loadURL(url));
			return { action: "allow" };
		} else {
			shell.openExternal(url);
			return { action: "deny" };
		}
	});

	win.webContents.on("will-navigate", (event, url) => {
		if (!isInternalAppUrl(url)) {
			event.preventDefault();
			shell.openExternal(url);
		}
	});

	updateNotificationIcon(win);

	return win;
}

function handleWindowControl(
	event: Electron.IpcMainInvokeEvent,
	action: string,
): any {
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
ipcMain.handle("bv-window-minimize", (event) =>
	handleWindowControl(event, "minimize"),
);
ipcMain.handle("bv-window-toggle-maximize", (event) =>
	handleWindowControl(event, "toggle-maximize"),
);
ipcMain.handle("bv-window-is-maximized", (event) =>
	handleWindowControl(event, "is-maximized"),
);
ipcMain.handle("bv-window-close", (event) =>
	handleWindowControl(event, "close"),
);
ipcMain.handle("bv-set-rich-presence-context", (event, payload) => {
	const win = BrowserWindow.fromWebContents(event.sender);
	if (!win || win.isDestroyed()) return false;
	setRichPresenceOverride(win, payload);
	return true;
});
ipcMain.handle("bv-check-for-updates", async () => {
	checkForUpdates();
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
	destroyRpcClient();
	if (tray) {
		tray.destroy();
		tray = null;
	}
	if (process.platform !== "darwin") {
		app.quit();
	}
});

app.on("quit", () => {
	destroyRpcClient();
});
