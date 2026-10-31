import {
	app,
	BrowserWindow,
	shell,
	nativeImage,
	ipcMain,
	Tray,
	Menu,
	session,
	globalShortcut,
	dialog,
} from "electron";
import path from "node:path";
import {
	setupRpc,
	destroyRpcClient,
	updateRpcActivity,
	setRichPresenceOverride,
	setRpcEnabled,
} from "./rpc";
import { getIconPath, getNotificationIconPath, updateNotificationIcon } from "./notification";
import { loadState, saveState } from "./windowState";
import {
	hasRecentExternalActivity,
	clearPresence,
	publishPresence,
	startPresenceRelay,
	stopPresenceRelay,
} from "./presence-relay";
import {
	checkForUpdates,
	configureUpdater,
	getUpdateState,
	installUpdate,
} from "./updater";
import { detectActivity, isSpotifyRunning } from "./activity-detector";
import {
	loadPresenceSettings,
	savePresenceSettings,
} from "./presence-settings";
import { loadDesktopSettings, saveDesktopSettings } from "./desktop-settings";
import { authenticatedApiFetch } from "./api-session";

let presenceSettings = loadPresenceSettings();
let desktopSettings = loadDesktopSettings();
let activityTimer: NodeJS.Timeout | null = null;
let spotifyPromptShown = false;
let hasPublishedDetectedPresence = false;
let lastPresenceDiagnosticState = "";
let lastSpotifyPlaybackState = "";
let lastSpotifyConnectionState = "";

async function clearDetectedPresence(): Promise<void> {
	if (!hasPublishedDetectedPresence) return;
	hasPublishedDetectedPresence = false;
	try {
		await clearPresence(getApiBaseUrl());
	} catch (error) {
		console.warn("[BV][Presence] Failed to clear detected activity:", error);
	}
}

ipcMain.handle("bv-open-devtools", (event) => {
	const win = BrowserWindow.fromWebContents(event.sender);
	if (win && !win.isDestroyed()) {
		win.webContents.openDevTools({ mode: "detach" });
		return true;
	}
	return false;
});

ipcMain.handle("bv-set-rpc-enabled", (event, enabled: boolean) => {
	presenceSettings = savePresenceSettings({
		...presenceSettings,
		discordEnabled: !!enabled,
	});
	return setRpcEnabled(
		presenceSettings.discordEnabled,
		BrowserWindow.fromWebContents(event.sender),
	);
});
ipcMain.handle("bv-get-presence-settings", () => presenceSettings);
ipcMain.handle("bv-set-presence-settings", async (_event, value) => {
	presenceSettings = savePresenceSettings(value);
	setRpcEnabled(presenceSettings.discordEnabled, mainWindow);
	await syncPresencePreferences();
	return presenceSettings;
});
ipcMain.handle("bv-get-desktop-settings", () => desktopSettings);
ipcMain.handle("bv-set-desktop-settings", (_event, value) => {
	desktopSettings = saveDesktopSettings(value);
	app.setLoginItemSettings({ openAtLogin: desktopSettings.launchAtLogin });
	return desktopSettings;
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
const LOCAL_API_BASE_URL = "http://127.0.0.1:3001";
const LIVE_API_BASE_URL = "https://api.brickverse.gg";
let activeBaseUrl = IS_DEV ? LOCAL_BASE_URL : LIVE_BASE_URL;

function getApiBaseUrl(): string {
	return activeBaseUrl === LOCAL_BASE_URL
		? LOCAL_API_BASE_URL
		: LIVE_API_BASE_URL;
}

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let settingsWindow: BrowserWindow | null = null;
let pendingDeepLink: string | null = null;

function resolveDeepLink(value: string): string | null {
	try {
		const url = new URL(value);
		if (url.protocol !== "brickverse:") return null;
		const pathName = `/${url.hostname}${url.pathname}`.replace(/\/{2,}/g, "/");
		if (!/^\/guilds\/[^/]+\/channels\/[^/]+(?:\/.*)?$/.test(pathName)) return null;
		return `${activeBaseUrl}${pathName}${url.search}${url.hash}`;
	} catch {
		return null;
	}
}

function openDeepLink(value: string): boolean {
	const target = resolveDeepLink(value);
	if (!target) return false;
	if (!mainWindow || mainWindow.isDestroyed()) {
		pendingDeepLink = value;
		return true;
	}
	mainWindow.show();
	if (mainWindow.isMinimized()) mainWindow.restore();
	mainWindow.focus();
	void mainWindow.loadURL(target);
	return true;
}

function refreshWindowIndicators(win: BrowserWindow): void {
	const count = updateNotificationIcon(win);
	if (!tray) return;
	tray.setImage(nativeImage.createFromPath(getNotificationIconPath(count)));
	tray.setToolTip(count > 0 ? `BrickVerse Guild Channels · ${count} unread` : "BrickVerse Guild Channels");
}

function getDefaultUrl(lastGuildUrl?: string): string {
	return `${activeBaseUrl}${lastGuildUrl || "/guilds/0/channels/landing"}`;
}

function getBaseMode(): "local" | "live" {
	return activeBaseUrl === LOCAL_BASE_URL ? "local" : "live";
}

function isInternalAppUrl(url: string): boolean {
	try {
		const parsed = new URL(url);
		return (
			parsed.origin === LOCAL_BASE_URL || parsed.origin === LIVE_BASE_URL
		);
	} catch {
		return false;
	}
}

function isApiUrl(url: string): boolean {
	try {
		const origin = new URL(url).origin;
		return origin === new URL(getApiBaseUrl()).origin;
	} catch {
		return false;
	}
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
		frame: true,
		backgroundColor: "#313338",
		autoHideMenuBar: true,
		icon: nativeImage.createFromPath(iconPath),
		webPreferences: {
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
			preload: path.join(__dirname, "preload.js"),
			spellcheck: true,
		},
	});

	mainWindow = win;
	win.on("closed", () => {
		if (mainWindow === win) {
			mainWindow = null;
		}
	});
	win.on("close", (event) => {
		if (!isQuitting && tray && desktopSettings.closeToTray) {
			event.preventDefault();
			win.hide();
		}
	});

	if (state.isMaximized) {
		win.maximize();
	}

	win.once("ready-to-show", () => {
		win.show();
	});

	win.loadURL(getDefaultUrl(state.lastGuildUrl));
	const persist = () => saveState(win);

	win.on("resize", persist);
	win.on("move", persist);
	win.on("maximize", persist);
	win.on("unmaximize", persist);
	win.on("close", persist);

	win.webContents.on("did-finish-load", () => {
		persist();
		refreshWindowIndicators(win);
		updateRpcActivity(win);
	});

	win.webContents.on("did-navigate", () => {
		persist();
		refreshWindowIndicators(win);
		updateRpcActivity(win);
	});

	win.webContents.on("did-redirect-navigation", () => {
		persist();
	});

	win.webContents.on("page-title-updated", () => {
		refreshWindowIndicators(win);
		updateRpcActivity(win);
	});

	win.webContents.setWindowOpenHandler(({ url }) => {
		if (isInternalAppUrl(url)) {
			setImmediate(() => win.loadURL(url));
			return { action: "deny" };
		} else if (isApiUrl(url)) {
			// Connection OAuth starts on the authenticated API origin, then follows
			// the provider flow in an isolated child window sharing this session.
			return {
				action: "allow",
				overrideBrowserWindowOptions: {
					parent: win,
					modal: true,
					width: 640,
					height: 760,
					webPreferences: { nodeIntegration: false, contextIsolation: true },
				},
			};
		} else {
			shell.openExternal(url);
			return { action: "deny" };
		}
	});

	win.webContents.on("before-input-event", (event, input) => {
		if (input.type !== "keyDown") return;
		const modifier =
			process.platform === "darwin" ? input.meta : input.control;
		if (modifier && input.key.toLowerCase() === "r") {
			event.preventDefault();
			input.shift ? win.webContents.reloadIgnoringCache() : win.reload();
		}
		if (modifier && ["+", "="].includes(input.key)) {
			event.preventDefault();
			win.webContents.setZoomLevel(win.webContents.getZoomLevel() + 0.5);
		}
		if (modifier && input.key === "-") {
			event.preventDefault();
			win.webContents.setZoomLevel(win.webContents.getZoomLevel() - 0.5);
		}
		if (modifier && input.key === "0") {
			event.preventDefault();
			win.webContents.setZoomLevel(0);
		}
	});

	win.webContents.on("will-navigate", (event, url) => {
		if (!isInternalAppUrl(url)) {
			event.preventDefault();
			shell.openExternal(url);
		}
	});

	refreshWindowIndicators(win);

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
ipcMain.handle("bv-check-for-updates", () => checkForUpdates(true));
ipcMain.handle("bv-get-update-state", () => getUpdateState());
ipcMain.handle("bv-install-update", () => installUpdate());

function createSettingsWindow(): void {
	if (settingsWindow && !settingsWindow.isDestroyed()) {
		settingsWindow.show();
		settingsWindow.focus();
		return;
	}
	settingsWindow = new BrowserWindow({
		width: 520,
		height: 650,
		minWidth: 440,
		minHeight: 560,
		parent: mainWindow || undefined,
		show: false,
		autoHideMenuBar: true,
		title: "BrickVerse Desktop Settings",
		backgroundColor: "#1e1f22",
		icon: nativeImage.createFromPath(getIconPath()),
		webPreferences: {
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
			preload: path.join(__dirname, "preload.js"),
		},
	});
	settingsWindow.once("ready-to-show", () => settingsWindow?.show());
	settingsWindow.on("closed", () => { settingsWindow = null; });
	void settingsWindow.loadFile(path.join(__dirname, "../src/settings.html"));
}

function createApplicationMenu(): void {
	const template: Electron.MenuItemConstructorOptions[] = [
		{
			label: "BrickVerse",
			submenu: [
				{ label: "Desktop Settings…", accelerator: "CmdOrCtrl+,", click: createSettingsWindow },
				{ label: "Check for Updates", click: () => void checkForUpdates(true) },
				{ type: "separator" },
				{ role: "quit" },
			],
		},
		{
			label: "Navigate",
			submenu: [
				{ label: "Back", accelerator: "Alt+Left", click: () => { if (mainWindow?.webContents.canGoBack()) mainWindow.webContents.goBack(); } },
				{ label: "Forward", accelerator: "Alt+Right", click: () => { if (mainWindow?.webContents.canGoForward()) mainWindow.webContents.goForward(); } },
				{ label: "Reload", accelerator: "CmdOrCtrl+R", click: () => mainWindow?.reload() },
				{ type: "separator" },
				{ role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" },
			],
		},
	];
	Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createTray(): void {
	if (tray) return;
	tray = new Tray(nativeImage.createFromPath(getIconPath()));
	tray.setToolTip("BrickVerse Guild Channels");
	tray.setContextMenu(
		Menu.buildFromTemplate([
			{
				label: "Open Guild Channels",
				click: () => {
					mainWindow?.show();
					mainWindow?.focus();
				},
			},
			{ label: "Desktop Settings", click: createSettingsWindow },
			{
				label: "Check for updates",
				click: () => void checkForUpdates(true),
			},
			{ type: "separator" },
			{
				label: "Quit",
				click: () => {
					isQuitting = true;
					app.quit();
				},
			},
		]),
	);
	tray.on("click", () => {
		mainWindow?.show();
		if (mainWindow?.isMinimized()) mainWindow.restore();
		mainWindow?.focus();
	});
	if (mainWindow) refreshWindowIndicators(mainWindow);
}

function configureWebSession(): void {
	const allowed = new Set([
		"media",
		"notifications",
		"fullscreen",
		"clipboard-sanitized-write",
	]);
	session.defaultSession.setPermissionCheckHandler(
		(_contents, permission, requestingOrigin) =>
			isInternalAppUrl(requestingOrigin) && allowed.has(permission),
	);
	session.defaultSession.setPermissionRequestHandler(
		(contents, permission, callback) =>
			callback(
				isInternalAppUrl(contents.getURL()) && allowed.has(permission),
			),
	);
	session.defaultSession.on("will-download", (_event, item) => {
		item.once("done", (_downloadEvent, state) => {
			if (state === "completed")
				shell.showItemInFolder(item.getSavePath());
		});
	});
}

async function syncPresencePreferences(): Promise<void> {
	try {
		const response = await authenticatedApiFetch(
			`${getApiBaseUrl()}/api/v3/social/presence/rich/settings`,
			{
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					richPresenceEnabled: presenceSettings.enabled,
					allowDetectedGameActivity: presenceSettings.detectGames,
					allowDetectedMusicActivity: presenceSettings.detectMusic,
				}),
			},
		);
		if (!response.ok) {
			console.warn(`[BV][Presence] Preference sync returned HTTP ${response.status}: ${await response.text()}`);
		}
	} catch (error) {
		console.warn("[BV][Presence] Failed to sync preferences:", error);
	}
}

async function promptSpotifyConnection(): Promise<void> {
	if (spotifyPromptShown || !mainWindow || mainWindow.isDestroyed()) return;
	spotifyPromptShown = true;
	const choice = await dialog.showMessageBox(mainWindow, {
		type: "info",
		title: "Connect Spotify",
		message: "Spotify is running. Connect it to show accurate listening activity on your BrickVerse profile.",
		detail: "BrickVerse reads only your current playback. Spotify cannot be used to sign in.",
		buttons: ["Connect Spotify", "Not now"],
		defaultId: 0,
		cancelId: 1,
	});
	if (choice.response === 0 && mainWindow && !mainWindow.isDestroyed()) {
		presenceSettings = savePresenceSettings({ ...presenceSettings, detectMusic: true });
		await syncPresencePreferences();
		void mainWindow.loadURL(`${activeBaseUrl}/my/settings/connections`);
	}
}

async function refreshDetectedActivity(): Promise<void> {
	if (hasRecentExternalActivity() && !presenceSettings.customEnabled) return;
	if (!presenceSettings.enabled) {
		await clearDetectedPresence();
		return;
	}
	const spotifyRunning = await isSpotifyRunning();
	const diagnosticState = `${presenceSettings.enabled}:${presenceSettings.detectMusic}:${presenceSettings.customEnabled}:${spotifyRunning}`;
	if (diagnosticState !== lastPresenceDiagnosticState) {
		lastPresenceDiagnosticState = diagnosticState;
		console.log(`[BV][Presence] enabled=${presenceSettings.enabled} detectMusic=${presenceSettings.detectMusic} custom=${presenceSettings.customEnabled} spotifyRunning=${spotifyRunning} api=${getApiBaseUrl()}`);
	}
	if (
		presenceSettings.enabled &&
		!presenceSettings.customEnabled &&
		spotifyRunning
	) {
		try {
			const statusResponse = await authenticatedApiFetch(
				`${getApiBaseUrl()}/api/v3/connections/spotify/status`,
			);
			if (!statusResponse.ok) {
				throw new Error(`Spotify connection status returned HTTP ${statusResponse.status}: ${await statusResponse.text()}`);
			}
			const status = (await statusResponse.json()) as { connected?: boolean };
			const connectionState = status.connected ? "linked" : "not linked";
			if (connectionState !== lastSpotifyConnectionState) {
				lastSpotifyConnectionState = connectionState;
				console.log(`[BV][Presence] Spotify connection status: ${connectionState}`);
			}
			if (!status.connected) {
				await promptSpotifyConnection();
				return;
			}
			const response = await authenticatedApiFetch(
				`${getApiBaseUrl()}/api/v3/connections/spotify/currently-playing`,
			);
			if (response.ok) {
				const result = (await response.json()) as {
					connected?: boolean;
					playing?: {
						trackId?: string | null;
						isPlaying: boolean;
						track: string;
						artists: string;
						album?: string | null;
						artworkUrl?: string | null;
						progressMs: number;
						durationMs: number;
						trackUrl?: string | null;
					} | null;
				};
				if (result.connected) {
					const playbackState = result.playing ? `${result.playing.trackId || result.playing.track}:${result.playing.isPlaying}` : "none";
					if (playbackState !== lastSpotifyPlaybackState) {
						lastSpotifyPlaybackState = playbackState;
						console.log(`[BV][Presence] Spotify playback changed: ${result.playing ? `${result.playing.track} — ${result.playing.artists} (${result.playing.isPlaying ? "playing" : "paused"})` : "nothing currently playing"}`);
					}
					if (presenceSettings.detectMusic && result.playing) {
						const now = Date.now();
						await publishPresence(getApiBaseUrl(), {
							activityType: "MUSIC",
							source: "spotify",
							applicationName: "Spotify",
							details: result.playing.track,
							state: `${result.playing.artists ? `by ${result.playing.artists}` : result.playing.album || "Spotify"}${result.playing.isPlaying ? "" : " • Paused"}`,
							assets: { largeImage: result.playing.artworkUrl, largeText: result.playing.album || result.playing.track },
							timestamps: result.playing.isPlaying ? {
								start: new Date(now - result.playing.progressMs).toISOString(),
								end: new Date(now + Math.max(0, result.playing.durationMs - result.playing.progressMs)).toISOString(),
							} : undefined,
							playback: { paused: !result.playing.isPlaying, positionMs: result.playing.progressMs, durationMs: result.playing.durationMs },
							secrets: { join: result.playing.trackUrl || undefined },
							ttlSeconds: 90,
						});
						hasPublishedDetectedPresence = true;
					}
					if (presenceSettings.detectMusic) {
						if (!result.playing) await clearDetectedPresence();
						return;
					}
				}
			} else {
				console.warn(`[BV][Presence] Spotify playback returned HTTP ${response.status}: ${await response.text()}`);
			}
		} catch (error) {
			console.warn(
				`[BV][Presence] BrickVerse Spotify proxy lookup failed (${getApiBaseUrl()}):`,
				error,
			);
		}
	}
	const activity = await detectActivity(presenceSettings);
	if (!activity) {
		await clearDetectedPresence();
		return;
	}
	try {
		const { metadataQuery, ...payload } = activity;
		if (
			metadataQuery &&
			(activity.activityType === "GAME" ||
				activity.activityType === "MUSIC")
		) {
			const response = await authenticatedApiFetch(
				`${getApiBaseUrl()}/api/v3/social/presence/metadata`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						type: activity.activityType,
						query: metadataQuery,
					}),
				},
			);
			if (response.ok) {
				const result = (await response.json()) as {
					metadata?: {
						name?: string;
						imageUrl?: string | null;
					} | null;
				};
				if (result.metadata?.imageUrl)
					payload.assets = {
						largeImage: result.metadata.imageUrl,
						largeText:
							result.metadata.name || payload.applicationName,
					};
				if (result.metadata?.name && activity.activityType === "GAME") {
					payload.applicationName = result.metadata.name;
					payload.details = `Playing ${result.metadata.name}`;
				}
			}
		}
		await publishPresence(getApiBaseUrl(), payload);
		hasPublishedDetectedPresence = true;
	} catch (error) {
		console.warn(
			"[BV][Presence] Failed to publish detected activity:",
			error,
		);
	}
}

app.whenReady().then(() => {
	console.log(`[BV][Presence] Starting activity monitor; API=${getApiBaseUrl()}`);
	app.setAsDefaultProtocolClient("brickverse");
	app.setLoginItemSettings({ openAtLogin: desktopSettings.launchAtLogin });
	if (process.platform === "win32") {
		app.setAppUserModelId("gg.brickverse.guildchannels");
	}
	configureWebSession();
	createApplicationMenu();
	configureUpdater();
	setupRpc();
	setRpcEnabled(presenceSettings.discordEnabled);
	startPresenceRelay(getApiBaseUrl);
	activityTimer = setInterval(() => void refreshDetectedActivity(), 5_000);
	setTimeout(() => {
		void refreshDetectedActivity();
	}, 3000);
	createWindow();
	createTray();
	const commandLineLink = process.argv.find((argument) => argument.startsWith("brickverse://"));
	if (pendingDeepLink) {
		openDeepLink(pendingDeepLink);
		pendingDeepLink = null;
	} else if (commandLineLink) openDeepLink(commandLineLink);
	setTimeout(() => void checkForUpdates(false), 5000);
	app.on("activate", () => {
		if (BrowserWindow.getAllWindows().length === 0) {
			createWindow();
		}
	});
});

let isQuitting = false;
let rpcDestroyed = false;

async function shutdownRpc(reason: string) {
	if (rpcDestroyed) return;
	rpcDestroyed = true;

	console.log(`[RPC] Shutting down Discord RPC: ${reason}`);

	try {
		if (activityTimer) clearInterval(activityTimer);
		activityTimer = null;
		await clearDetectedPresence();
		stopPresenceRelay();
		destroyRpcClient();
	} catch (err) {
		console.warn("[RPC] Failed to destroy RPC client:", err);
	}
}

app.on("before-quit", () => {
	isQuitting = true;
	void shutdownRpc("before-quit");
});

app.on("will-quit", (event) => {
	isQuitting = true;
	void shutdownRpc("will-quit");
});

app.on("quit", () => {
	void shutdownRpc("quit");
});

app.on("window-all-closed", () => {
	void shutdownRpc("window-all-closed");

	if (process.platform !== "darwin") {
		app.quit();
	}
});

app.on("browser-window-focus", () => {
	if (!isQuitting && mainWindow) {
		updateRpcActivity(mainWindow);
	}
});

app.on("activate", () => {
	if (!isQuitting && mainWindow) {
		updateRpcActivity(mainWindow);
	}
});

app.on("second-instance", (_event, commandLine) => {
	if (!isQuitting && mainWindow) {
		const deepLink = commandLine.find((argument) => argument.startsWith("brickverse://"));
		if (deepLink && openDeepLink(deepLink)) return;
		mainWindow.show();
		if (mainWindow.isMinimized()) mainWindow.restore();
		mainWindow.focus();
		updateRpcActivity(mainWindow);
	}
});

app.on("open-url", (event, url) => {
	event.preventDefault();
	if (!openDeepLink(url)) pendingDeepLink = url;
});

process.once("exit", () => {
	// Cannot reliably await here
	void shutdownRpc("process-exit");
});

process.once("SIGINT", async () => {
	await shutdownRpc("SIGINT");
	process.exit(0);
});

process.once("SIGTERM", async () => {
	await shutdownRpc("SIGTERM");
	process.exit(0);
});

process.once("uncaughtException", async (err) => {
	console.error("[Fatal] uncaughtException:", err);
	await shutdownRpc("uncaughtException");
	process.exit(1);
});

process.once("unhandledRejection", async (reason) => {
	console.error("[Fatal] unhandledRejection:", reason);
	await shutdownRpc("unhandledRejection");
	process.exit(1);
});

process.once("warning", (warning) => {
	console.warn("[Warning] Process warning:", warning);
});

app.on("will-quit", () => {
	// A second instance can fail to acquire the lock and quit before Electron is
	// ready. globalShortcut is unavailable until readiness, and there cannot be
	// any registered shortcuts to clean up in that case.
	if (app.isReady()) globalShortcut.unregisterAll();
});

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) app.quit();
