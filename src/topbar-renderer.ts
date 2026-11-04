type ShellState = {
	title: string;
	url: string;
	unread: number;
	canGoBack: boolean;
	canGoForward: boolean;
	loading: boolean;
	connection: "local" | "live";
	user?: { id: string; username: string; headshotUrl: string } | null;
};

interface Window {
	bvShell?: {
		control: (action: string) => Promise<unknown>;
		getDesktopSettings: () => Promise<any>;
		setDesktopSettings: (settings: any) => Promise<any>;
		checkForUpdates: () => Promise<unknown>;
		installUpdate: () => Promise<unknown>;
		getUpdateState: () => Promise<any>;
		getState: () => Promise<ShellState | null>;
		getNotifications: () => Promise<any>;
		readNotification: (id: string) => Promise<boolean>;
		openPath: (path: string) => Promise<boolean>;
		onState: (listener: (state: ShellState) => void) => () => void;
		onUpdate: (listener: (state: any) => void) => () => void;
	};
}

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const control = (action: string) => void window.bvShell?.control(action);
let latest: ShellState | null = null;

element<HTMLButtonElement>("back").onclick = () => control("back");
element<HTMLButtonElement>("forward").onclick = () => control("forward");
element<HTMLButtonElement>("reload").onclick = () => control("reload");
element<HTMLButtonElement>("minimize").onclick = () => control("minimize");
element<HTMLButtonElement>("maximize").onclick = () => control("toggle-maximize");
element<HTMLButtonElement>("close").onclick = () => control("close");
element<HTMLButtonElement>("environment").onclick = () => control("toggle-base-url");
element<HTMLButtonElement>("command-palette").onclick = () => control("command-palette");
element<HTMLButtonElement>("app-theme").onclick = () => control("app-theme");

const tools = document.querySelector<HTMLElement>(".tools")!;
const settingsButton = document.createElement("button");
settingsButton.id = "desktop-settings";
settingsButton.title = "Desktop settings";
settingsButton.setAttribute("aria-label", "Desktop settings");
settingsButton.innerHTML = '<svg class="icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1z"/></svg>';
settingsButton.onclick = () => control("settings");
tools.insertBefore(settingsButton, element("notifications"));

const profileButton = document.createElement("button");
profileButton.id = "shell-profile";
profileButton.className = "shell-profile";
profileButton.title = "Your profile";
profileButton.setAttribute("aria-label", "Open your profile");
profileButton.innerHTML = '<img alt=""><span></span>';
profileButton.onclick = () => control("open-profile");
tools.insertBefore(profileButton, document.querySelector(".window-controls"));

const notificationPanel = element<HTMLElement>("notification-panel");
element<HTMLButtonElement>("notifications").onclick = () => {
	notificationPanel.classList.remove("open");
	control("notifications");
};
element<HTMLButtonElement>("dismiss-panel").onclick = () => {
	notificationPanel.classList.remove("open");
};
element<HTMLButtonElement>("open-dms").onclick = () => {
	notificationPanel.classList.remove("open");
	control("open-direct-messages");
};

async function syncNotificationPreference() {
	const settings = await window.bvShell?.getDesktopSettings();
	const toggle = element<HTMLInputElement>("desktop-notifications");
	toggle.checked = settings?.notificationsEnabled !== false;
	toggle.onchange = async () => {
		await window.bvShell?.setDesktopSettings({ ...settings, notificationsEnabled: toggle.checked });
		element<HTMLElement>("notification-status").textContent = toggle.checked ? "Desktop alerts are enabled" : "Desktop alerts are paused";
	};
}

async function loadNotifications() {
	const list = element<HTMLElement>("notification-list");
	try {
		const result = await window.bvShell?.getNotifications();
		const notifications = Array.isArray(result?.notifications) ? result.notifications.slice(0, 6) : [];
		list.replaceChildren();
		if (!notifications.length) {
			const empty = document.createElement("div");
			empty.className = "notification-empty";
			empty.textContent = "No recent notifications";
			list.append(empty);
			return;
		}
		for (const item of notifications) {
			const button = document.createElement("button");
			button.className = `notification-item${item.isRead ? "" : " unread"}`;
			const title = document.createElement("strong");
			title.textContent = String(item.title || "Notification");
			const message = document.createElement("small");
			message.textContent = String(item.message || "");
			button.append(title, message);
			button.onclick = async () => {
				if (item.id) await window.bvShell?.readNotification(String(item.id));
				const metadata = item.metadata && typeof item.metadata === "object" ? item.metadata : {};
				const href = typeof metadata.href === "string" && metadata.href.startsWith("/") ? metadata.href : `/my/notifications#${encodeURIComponent(String(item.id || ""))}`;
				await window.bvShell?.openPath(href);
				notificationPanel.classList.remove("open");
			};
			list.append(button);
		}
	} catch {
		list.textContent = "Notifications are temporarily unavailable.";
	}
}

function render(state: ShellState) {
	latest = state;
	element<HTMLElement>("page-title").textContent = state.title || "Guild Channels";
	element<HTMLElement>("location").textContent = state.url ? new URL(state.url).pathname : "Guild Channels";
	element<HTMLButtonElement>("back").disabled = !state.canGoBack;
	element<HTMLButtonElement>("forward").disabled = !state.canGoForward;
	element<HTMLElement>("environment").dataset.mode = state.connection;
	element<HTMLElement>("environment-label").textContent = state.connection === "local" ? "Local" : "Secure";
	const badge = element<HTMLElement>("notification-count");
	badge.textContent = state.unread > 99 ? "99+" : String(state.unread);
	badge.hidden = state.unread < 1;
	element<HTMLElement>("notification-summary").textContent = state.unread
		? `${state.unread} unread ${state.unread === 1 ? "notification" : "notifications"}`
		: "You're all caught up";
	const profile = element<HTMLButtonElement>("shell-profile");
	profile.hidden = !state.user?.id;
	profile.title = state.user?.username ? `Open ${state.user.username}'s profile` : "Your profile";
	profile.querySelector<HTMLImageElement>("img")!.src = state.user?.headshotUrl || "";
	profile.querySelector<HTMLElement>("span")!.textContent = state.user?.username || "";
}

window.bvShell?.onState(render);
void window.bvShell?.getState().then((state) => { if (state) render(state); });
function renderUpdateState(state: any) {
	const update = element<HTMLElement>("update-state");
	const labels: Record<string, string> = {
		checking: "Checking…",
		available: `Downloading ${state?.version || "update"}…`,
		downloading: `Downloading ${state?.percent ?? 0}%`,
		downloaded: "Restart to update",
		"not-available": state?.message || "You're up to date",
		error: "Update check failed",
	};
	update.hidden = !labels[state?.status];
	update.textContent = labels[state?.status] || "";
	update.title = state?.message || update.textContent;
}
window.bvShell?.onUpdate(renderUpdateState);
element<HTMLButtonElement>("check-updates").onclick = async () => renderUpdateState(await window.bvShell?.checkForUpdates());
element<HTMLButtonElement>("update-state").onclick = () => void window.bvShell?.installUpdate();
void syncNotificationPreference();
void loadNotifications();
window.setInterval(() => void loadNotifications(), 30_000);

document.addEventListener("pointerdown", (event) => {
	if (!notificationPanel.contains(event.target as Node) && !(event.target as Element).closest("#notifications")) {
		notificationPanel.classList.remove("open");
	}
});



