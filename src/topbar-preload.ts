import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("bvShell", {
	control: (action: string) => ipcRenderer.invoke("bv-window-control", action),
	getDesktopSettings: () => ipcRenderer.invoke("bv-get-desktop-settings"),
	setDesktopSettings: (settings: unknown) => ipcRenderer.invoke("bv-set-desktop-settings", settings),
	checkForUpdates: () => ipcRenderer.invoke("bv-check-for-updates"),
	installUpdate: () => ipcRenderer.invoke("bv-install-update"),
	getUpdateState: () => ipcRenderer.invoke("bv-get-update-state"),
	getState: () => ipcRenderer.invoke("bv-shell-get-state"),
	getNotifications: () => ipcRenderer.invoke("bv-shell-notifications"),
	readNotification: (id: string) => ipcRenderer.invoke("bv-shell-read-notification", id),
	openPath: (path: string) => ipcRenderer.invoke("bv-shell-open-path", path),
	onState: (listener: (state: unknown) => void) => {
		const wrapped = (_event: Electron.IpcRendererEvent, state: unknown) => listener(state);
		ipcRenderer.on("bv-shell-state", wrapped);
		return () => ipcRenderer.removeListener("bv-shell-state", wrapped);
	},
	onUpdate: (listener: (state: unknown) => void) => {
		const wrapped = (_event: Electron.IpcRendererEvent, state: unknown) => listener(state);
		ipcRenderer.on("bv-update-state", wrapped);
		return () => ipcRenderer.removeListener("bv-update-state", wrapped);
	},
});

