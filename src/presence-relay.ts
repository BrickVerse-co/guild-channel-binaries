import dgram from "node:dgram";
import { session } from "electron";

const RELAY_PORT = 45837;
const MAX_PACKET_BYTES = 16 * 1024;
let relay: dgram.Socket | null = null;
let latestRequest: Promise<void> = Promise.resolve();
let pendingPayload: Record<string, unknown> | { clear: true } | null = null;
let publishTimer: NodeJS.Timeout | null = null;

function text(value: unknown, maximum: number): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed ? trimmed.slice(0, maximum) : undefined;
}

function imageUrl(value: unknown, applicationId: string | undefined): string | undefined {
	const image = text(value, 255);
	if (!image) return undefined;
	if (/^https?:\/\//i.test(image)) return image;
	if (!applicationId) return undefined;
	return `https://cdn.discordapp.com/app-assets/${encodeURIComponent(applicationId)}/${encodeURIComponent(image)}.png`;
}

function normalizePayload(input: unknown): Record<string, unknown> | { clear: true } | null {
	if (!input || typeof input !== "object") return null;
	const value = input as Record<string, any>;
	if (value.source !== "brickverse-client" && value.source !== "brickverse-rich-presence-sdk") return null;
	if (value.clear === true) return { clear: true };
	const applicationId = text(value.applicationId, 64);
	const party = value.party && typeof value.party === "object" ? value.party : {};
	const size = Array.isArray(party.size) && party.size.length === 2
		? [Math.max(0, Number(party.size[0]) || 0), Math.max(0, Number(party.size[1]) || 0)]
		: undefined;
	return {
		applicationId,
		applicationName: text(value.applicationName, 100) ?? "BrickVerse",
		details: text(value.details, 128),
		state: text(value.state, 128),
		assets: {
			largeImage: imageUrl(value.assets?.largeImage, applicationId),
			largeText: text(value.assets?.largeText, 128),
			smallImage: imageUrl(value.assets?.smallImage, applicationId),
			smallText: text(value.assets?.smallText, 128),
		},
		party: { id: text(party.id, 128), size },
		secrets: { join: text(value.secrets?.join, 255) },
		timestamps: {
			start: text(value.timestamps?.start, 64),
			end: text(value.timestamps?.end, 64),
		},
		ttlSeconds: 300,
	};
}

async function publishPresence(baseUrl: string, payload: Record<string, unknown>): Promise<void> {
	const response = await session.defaultSession.fetch(`${baseUrl}/api/v3/social/presence/rich`, {
		method: "PUT",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(payload),
		credentials: "include",
	});
	if (!response.ok && response.status !== 401) {
		console.warn(`[BV][Presence Relay] Backend returned HTTP ${response.status}`);
	}
}

export function startPresenceRelay(getBaseUrl: () => string): void {
	if (relay) return;
	relay = dgram.createSocket("udp4");
const queue = (payload: Record<string, unknown> | { clear: true }) => {
		pendingPayload = payload;
		if (publishTimer) return;
		publishTimer = setTimeout(() => {
			publishTimer = null;
			const next = pendingPayload;
			pendingPayload = null;
			if (!next) return;
			latestRequest = latestRequest
				.catch(() => undefined)
				.then(() => next.clear
					? session.defaultSession.fetch(`${getBaseUrl()}/api/v3/social/presence/rich`, { method: "DELETE", credentials: "include" }).then(() => undefined)
					: publishPresence(getBaseUrl(), next))
				.catch((error) => console.warn("[BV][Presence Relay] Publish failed:", error));
		}, 500);
	};
	relay.on("message", (message, remote) => {
		if (remote.address !== "127.0.0.1" || message.byteLength > MAX_PACKET_BYTES) return;
		try {
			const payload = normalizePayload(JSON.parse(message.toString("utf8")));
			if (!payload) return;
			queue(payload);
		} catch {
			// Ignore malformed local datagrams.
		}
	});
	relay.on("error", (error) => console.warn("[BV][Presence Relay] Listener error:", error));
	relay.bind(RELAY_PORT, "127.0.0.1");
}

export function stopPresenceRelay(): void {
	if (publishTimer) clearTimeout(publishTimer);
	publishTimer = null;
	pendingPayload = null;
	relay?.close();
	relay = null;
}
