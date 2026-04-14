// (c) 2026 Meta Games LLC. All rights reserved.

const { contextBridge, ipcRenderer } = require("electron");
let installDesktopTitlebar = null;

try {
	({ installDesktopTitlebar } = require("./desktop-titlebar"));
} catch (err) {
	console.error("[BV] failed to load desktop-titlebar module", err);
}

console.log("[BV] preload loaded");

const windowControl = (action) => {
	return ipcRenderer.invoke("bv-window-control", action);
};

const setRichPresenceContext = (payload) => {
	return ipcRenderer.invoke("bv-set-rich-presence-context", payload ?? null);
};

contextBridge.exposeInMainWorld("bvDesktop", {
	windowControl,
	setRichPresenceContext,
	getBaseUrlMode: () => windowControl("get-base-url-mode"),
	toggleBaseUrl: () => windowControl("toggle-base-url"),
	minimize: () => windowControl("minimize"),
	toggleMaximize: () => windowControl("toggle-maximize"),
	isMaximized: () => windowControl("is-maximized"),
	close: () => windowControl("close"),
});

const boot = () => {
	try {
		if (typeof installDesktopTitlebar !== "function") {
			console.error("[BV] installDesktopTitlebar unavailable");
			return;
		}

		installDesktopTitlebar({
			windowControl,
			setRichPresenceContext,
			getBaseUrlMode: () => windowControl("get-base-url-mode"),
			toggleBaseUrl: () => windowControl("toggle-base-url"),
			minimize: () => windowControl("minimize"),
			toggleMaximize: () => windowControl("toggle-maximize"),
			isMaximized: () => windowControl("is-maximized"),
			close: () => windowControl("close"),
		});
	} catch (err) {
		console.error("[BV] installDesktopTitlebar failed", err);
	}
};

if (document.readyState === "loading") {
	window.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
	boot();
}
