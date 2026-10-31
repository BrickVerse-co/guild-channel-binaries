declare global {
	interface Window {
		bvDesktop?: {
			getPresenceSettings?: () => Promise<any>;
			setPresenceSettings?: (value: any) => Promise<any>;
			getDesktopSettings?: () => Promise<any>;
			setDesktopSettings?: (value: any) => Promise<any>;
		};
	}
}

const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const checkbox = (id: string) => byId<HTMLInputElement>(id);
const field = (id: string) => byId<HTMLInputElement>(id);

async function load(): Promise<void> {
	const [settings, desktop] = await Promise.all([
		window.bvDesktop?.getPresenceSettings?.(),
		window.bvDesktop?.getDesktopSettings?.(),
	]);
	if (!settings) return;
	checkbox("enabled").checked = settings.enabled;
	checkbox("games").checked = settings.detectGames;
	checkbox("music").checked = settings.detectMusic;
	checkbox("discord").checked = settings.discordEnabled;
	checkbox("custom").checked = settings.customEnabled;
	field("name").value = settings.customName || "";
	field("details").value = settings.customDetails || "";
	field("state").value = settings.customState || "";
	checkbox("launchAtLogin").checked = desktop?.launchAtLogin === true;
	checkbox("closeToTray").checked = desktop?.closeToTray !== false;
}

byId<HTMLButtonElement>("save").addEventListener("click", async () => {
	const status = byId<HTMLSpanElement>("status");
	status.textContent = "Saving…";
	await Promise.all([window.bvDesktop?.setPresenceSettings?.({
		enabled: checkbox("enabled").checked,
		detectGames: checkbox("games").checked,
		detectMusic: checkbox("music").checked,
		discordEnabled: checkbox("discord").checked,
		customEnabled: checkbox("custom").checked,
		customName: field("name").value,
		customDetails: field("details").value,
		customState: field("state").value,
	}), window.bvDesktop?.setDesktopSettings?.({
		launchAtLogin: checkbox("launchAtLogin").checked,
		closeToTray: checkbox("closeToTray").checked,
	})]);
	status.textContent = "Saved";
});

void load();

export {};
