import { contextBridge, ipcRenderer } from "electron";
import { installDesktopTitlebar } from "./desktop-titlebar";

const invokeSafe = (channel: string, ...args: any[]) => {
	try {
		return ipcRenderer.invoke(channel, ...args);
	} catch (err) {
		console.error(`[BV] ipc invoke failed: ${channel}`, err);
		return undefined;
	}
};

const windowControl = (action: string) => {
	return invokeSafe("bv-window-control", action);
};

const setRichPresenceContext = (payload: any) => {
	return invokeSafe("bv-set-rich-presence-context", payload ?? null);
};

const desktopApi = {
	windowControl,
	setRichPresenceContext,
	getBaseUrlMode: () => windowControl("get-base-url-mode"),
	toggleBaseUrl: () => windowControl("toggle-base-url"),
	minimize: () => windowControl("minimize"),
	toggleMaximize: () => windowControl("toggle-maximize"),
	isMaximized: () => windowControl("is-maximized"),
	close: () => windowControl("close"),
	checkForUpdates: () => invokeSafe("bv-check-for-updates"),
	openDevTools: () => invokeSafe("bv-open-devtools"),
	setRpcEnabled: (enabled: boolean) =>
		invokeSafe("bv-set-rpc-enabled", enabled),
	getAboutInfo: () => invokeSafe("bv-get-about-info"),
};

contextBridge.exposeInMainWorld("bvDesktop", desktopApi);

const boot = () => {
	try {
		installDesktopTitlebar(desktopApi);
	} catch (err) {
		console.error("[BV] installDesktopTitlebar failed", err);
	}
};

if (document.readyState === "loading") {
	window.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
	boot();
}
