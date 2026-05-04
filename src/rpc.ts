import { BrowserWindow } from "electron";
import DiscordRPC, { Client as DiscordRpcClient, Presence } from "discord-rpc";

const DISCORD_CLIENT_ID = "1493410322797826239";
let rpcClient: DiscordRpcClient | null = null;
let rpcReady = false;
let rpcActivityDebounce: NodeJS.Timeout | null = null;
const rpcPresenceOverrides = new Map<number, any>();
let rpcClientDestroyed = false;

export function destroyRpcClient() {
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

function logRpcDebug(message: string, extra?: any) {
	if (typeof extra === "undefined") {
		console.log(`[BV][RPC] ${message}`);
		return;
	}
	console.log(`[BV][RPC] ${message}`, extra);
}

export function setupRpc() {
	if (!DISCORD_CLIENT_ID) {
		console.warn("[BV] DISCORD_CLIENT_ID not set — Rich Presence disabled");
		return;
	}
    
	DiscordRPC.register(DISCORD_CLIENT_ID);

	rpcClient = new DiscordRPC.Client({ transport: "ipc" });
	rpcClient.on("ready", () => {
		rpcReady = true;
		console.log("[BV] Discord RPC ready");
		// mainWindow will be set in main.ts
	});

	rpcClient.on("disconnected", () => {
		rpcReady = false;
	});

	rpcClient.on("error", (err: any) => {
		console.warn("[BV] Discord RPC client error:", err?.message || err);
	});

	rpcClient.login({ clientId: DISCORD_CLIENT_ID }).catch((err: any) => {
		console.warn("[BV] Discord RPC login failed:", err.message);
	});
}

export function updateRpcActivity(win: BrowserWindow | null) {
	if (!rpcReady || !rpcClient || !win || win.isDestroyed()) {
		return;
	}
	if (rpcActivityDebounce) clearTimeout(rpcActivityDebounce);
	rpcActivityDebounce = setTimeout(() => {
		try {
			const activity = buildActivityFromWindow(win);
			rpcClient!.setActivity(activity).catch((err: any) => {
				console.warn("[BV] Discord RPC setActivity failed:", err.message);
			});
		} catch (err: any) {
			console.warn("[BV] Discord RPC update error:", err.message);
		}
	}, 1000);
}

export function setRichPresenceOverride(win: BrowserWindow, payload: any) {
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

function sanitizePresenceText(value: any, fallback: string): string {
	if (typeof value !== "string") return fallback;
	const trimmed = value.trim();
	if (!trimmed) return fallback;
	return trimmed.slice(0, 128);
}

function getPresenceOverride(win: BrowserWindow) {
	if (!win || win.isDestroyed()) return null;
	return rpcPresenceOverrides.get(win.webContents.id) || null;
}

export function buildActivityFromWindow(win: BrowserWindow): Presence {
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

function parsePresenceFromPage(title: string, url: string) {
	const cleanTitle = title.replace(/^\(\d+\)\s*/, "");
	const parts = cleanTitle.split(" | ").map((s) => s.trim());
	if (/\/guilds\/[^/]+\/channels\/[^/?#]+/.test(url)) {
		return {
			details: parts[0] ? `Viewing ${parts[0]}` : "Viewing a channel",
			state: parts[1] || "BrickVerse Guild",
		};
	}
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
