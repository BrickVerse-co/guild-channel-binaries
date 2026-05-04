// Use window.require to get ipcRenderer for maximum compatibility
const electron = (window as any).require
	? (window as any).require("electron")
	: undefined;
const ipcRenderer = electron ? electron.ipcRenderer : undefined;
import { contextBridge } from "electron";
import { installDesktopTitlebar } from "./desktop-titlebar";

const windowControl = (action: string) => {
	if (!ipcRenderer) throw new Error("ipcRenderer unavailable");
	return ipcRenderer.invoke("bv-window-control", action);
};

const setRichPresenceContext = (payload: any) => {
	if (!ipcRenderer) throw new Error("ipcRenderer unavailable");
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
	checkForUpdates: () => ipcRenderer.invoke("bv-check-for-updates"),
	openDevTools: () => ipcRenderer.invoke("bv-open-devtools"),
	setRpcEnabled: (enabled: boolean) =>
		ipcRenderer.invoke("bv-set-rpc-enabled", enabled),
	getAboutInfo: () => ipcRenderer.invoke("bv-get-about-info"),
});


const boot = () => {
	try {
		installDesktopTitlebar(window.bvDesktop);
	} catch (err) {
		console.error("[BV] installDesktopTitlebar failed", err);
	}
};

if (document.readyState === "loading") {
	window.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
	boot();
}
