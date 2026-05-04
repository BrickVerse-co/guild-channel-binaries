import {
	TITLEBAR_HEIGHT,
	TITLEBAR_ID,
	STYLE_ID,
	ROOT_ATTR,
	TITLE_REFRESH_MS,
	CLOUD_ICON_SVG,
	MAXIMIZE_ICON_SVG,
	RESTORE_ICON_SVG,
} from "./titlebar-constants";

const SETTINGS_ICON_SVG =
	'<svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="10" cy="10" r="3.5"/><path d="M10 2v2M10 16v2M4.22 4.22l1.42 1.42M14.36 14.36l1.42 1.42M2 10h2m12 0h2M4.22 15.78l1.42-1.42M14.36 5.64l1.42-1.42"/></svg>';

let observersStarted = false;
let keepAliveTimer: NodeJS.Timeout | null = null;
let injectedDesktopApi: any = null;

function getDesktopApi() {
	if (injectedDesktopApi) {
		return injectedDesktopApi;
	}
	if (!(window as any).bvDesktop) {
		console.error("[BV] window.bvDesktop is unavailable");
		return null;
	}
	return (window as any).bvDesktop;
}

async function windowControl(action: string) {
	const api = getDesktopApi();
	if (!api) throw new Error("[BV] window bridge unavailable");
	if (typeof api.windowControl === "function") {
		return api.windowControl(action);
	}
	// Backward compatibility if preload is stale.
	switch (action) {
		case "minimize":
			if (typeof api.minimize === "function") return api.minimize();
			break;
		case "toggle-maximize":
			if (typeof api.toggleMaximize === "function") return api.toggleMaximize();
			break;
		case "is-maximized":
			if (typeof api.isMaximized === "function") return api.isMaximized();
			break;
		case "close":
			if (typeof api.close === "function") return api.close();
			break;
		case "get-base-url-mode":
			if (typeof api.getBaseUrlMode === "function") return api.getBaseUrlMode();
			break;
		case "toggle-base-url":
			if (typeof api.toggleBaseUrl === "function") return api.toggleBaseUrl();
			break;
	}
	throw new Error(`[BV] windowControl unsupported action: ${action}`);
}

function applyAppOffset() {
	if (!document.documentElement) return;
	document.documentElement.style.setProperty(
		"--bv-titlebar-height",
		`${TITLEBAR_HEIGHT}px`,
	);
	document.documentElement.setAttribute(ROOT_ATTR, "true");
}

function syncPageTitle() {
	const el = document.getElementById("bv-titlebar-page-title");
	if (!el) return;
	el.textContent = (document.title || "BrickVerse").trim() || "BrickVerse";
}

async function syncMaximizeButton() {
	const btn = document.getElementById("bv-max-btn");
	if (!btn) return;
	try {
		const isMaximized = await windowControl("is-maximized");
		btn.innerHTML = isMaximized ? RESTORE_ICON_SVG : MAXIMIZE_ICON_SVG;
		btn.setAttribute("aria-label", isMaximized ? "Restore" : "Maximize");
	} catch (err) {
		console.error("[BV] syncMaximizeButton failed", err);
	}
}

async function syncCloudButton() {
	const btn = document.getElementById("bv-cloud-btn");
	if (!btn) return;
	try {
		const mode = await windowControl("get-base-url-mode");
		const isLocal = mode === "local";
		btn.dataset.mode = mode;
		btn.setAttribute(
			"aria-label",
			isLocal ? "Switch to live site" : "Switch to localhost",
		);
		btn.setAttribute(
			"title",
			isLocal
				? "Currently Localhost. Switch to brickverse.gg"
				: "Currently Live. Switch to localhost",
		);
		btn.classList.toggle("is-local", isLocal);
		btn.classList.toggle("is-live", !isLocal);
		const label = btn.querySelector(".bv-titlebar-env-label");
		if (label) {
			label.textContent = isLocal ? "LOCAL" : "LIVE";
		}
	} catch (err) {
		console.error("[BV] syncCloudButton failed", err);
	}
}

function ensureStyle() {
	if (document.getElementById(STYLE_ID)) return;
	const style = document.createElement("style");
	style.id = STYLE_ID;
	style.textContent = `
    #${TITLEBAR_ID} {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      height: ${TITLEBAR_HEIGHT}px;
      display: grid;
      grid-template-columns: auto 1fr auto;
      align-items: center;
      background: rgba(35, 36, 40, 0.98);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      border-bottom: 1px solid rgba(255,255,255,0.08);
      z-index: 2147483647;
      user-select: none;
      font-family: Inter, Arial, sans-serif;
    }
    #${TITLEBAR_ID} * { box-sizing: border-box; }
    .bv-titlebar-left, .bv-titlebar-center, .bv-titlebar-right {
      height: 100%; display: flex; align-items: center;
    }
    .bv-titlebar-left, .bv-titlebar-center { -webkit-app-region: drag; }
    .bv-titlebar-left { padding: 0 12px; flex: 0 0 auto; }
    .bv-titlebar-logo { height: 20px; width: auto; display: block; pointer-events: none; }
    .bv-titlebar-center { justify-content: center; overflow: hidden; padding: 0 16px; min-width: 0; flex: 1 1 auto; pointer-events: none; }
    #bv-titlebar-page-title { color: #dbdee1; font-size: 13px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 60vw; text-align: center; }
    .bv-titlebar-right { -webkit-app-region: no-drag; margin-left: auto; z-index: 2; flex: 0 0 auto; }
    .bv-titlebar-btn { width: 46px; height: 100%; display: inline-flex; align-items: center; justify-content: center; border: 0; background: transparent; color: #b5bac1; cursor: pointer; font-size: 14px; line-height: 1; -webkit-app-region: no-drag; pointer-events: auto; padding: 0; }
    .bv-titlebar-btn.bv-cloud-btn { width: auto; gap: 6px; padding: 0 12px; font-size: 11px; font-weight: 700; letter-spacing: 0.08em; }
    .bv-titlebar-btn.bv-cloud-btn svg { width: 14px; height: 14px; }
		.bv-titlebar-btn.bv-cloud-btn.is-local {
			color: #6ee7b7;
			background: rgba(110,231,183,0.08);
			border-radius: 6px;
		}
		.bv-titlebar-btn.bv-cloud-btn.is-live {
			color: #93c5fd;
			background: rgba(147,197,253,0.08);
			border-radius: 6px;
		}
    .bv-titlebar-env-label { min-width: 34px; text-align: left; }
	.bv-titlebar-btn svg { width: 16px; height: 16px; display: block; fill: none; stroke: currentColor; stroke-width: 1.2; shape-rendering: geometricPrecision; }
    .bv-titlebar-btn:hover { background: rgba(255,255,255,0.08); color: #fff; }
    .bv-titlebar-btn.bv-close:hover { background: #da373c; }
  `;
	document.head.appendChild(style);
}

function ensureTitlebar() {
	let bar = document.getElementById(TITLEBAR_ID);
	if (bar) return bar;
	bar = document.createElement("div");
	bar.id = TITLEBAR_ID;
	bar.innerHTML = `
    <div class="bv-titlebar-left">
	<img class="bv-titlebar-logo" src="https://brickverse.gg/img/brand/light_long.png" alt="BrickVerse" />
    </div>
		<div class="bv-titlebar-center">
			<div id="bv-titlebar-page-title">BrickVerse</div>
		</div>
		<div class="bv-titlebar-right">
			<button class="bv-titlebar-btn" id="bv-settings-btn" aria-label="Settings" title="Settings">${SETTINGS_ICON_SVG}</button>
			<button class="bv-titlebar-btn" id="bv-about-btn" aria-label="About" title="About">ⓘ</button>
			<button class="bv-titlebar-btn bv-cloud-btn" id="bv-cloud-btn" aria-label="Switch environment" title="Switch environment">${CLOUD_ICON_SVG}<span class="bv-titlebar-env-label">LIVE</span></button>
			<button class="bv-titlebar-btn" id="bv-min-btn" aria-label="Minimize">—</button>
			<button class="bv-titlebar-btn" id="bv-max-btn" aria-label="Maximize">${MAXIMIZE_ICON_SVG}</button>
			<button class="bv-titlebar-btn bv-close" id="bv-close-btn" aria-label="Close">✕</button>
		</div>
  `;
	if (document.body) {
		document.body.appendChild(bar);
	} else {
		document.documentElement.appendChild(bar);
	}
	return bar;
}

function bindEvents(bar: HTMLElement) {
	if (!bar || bar.dataset.bound === "1") return;
	bar.dataset.bound = "1";
	const minBtn = document.getElementById("bv-min-btn");
	const maxBtn = document.getElementById("bv-max-btn");
	const closeBtn = document.getElementById("bv-close-btn");
	const cloudBtn = document.getElementById("bv-cloud-btn");
	const updateBtn = document.getElementById("bv-update-btn");
	const settingsBtn = document.getElementById("bv-settings-btn");
	const aboutBtn = document.getElementById("bv-about-btn");
	settingsBtn?.addEventListener("click", (event) => {
		event.preventDefault();
		event.stopPropagation();
		showSettingsModal();
	});
	aboutBtn?.addEventListener("click", (event) => {
		event.preventDefault();
		event.stopPropagation();
		showAboutModal();
	});
	function showSettingsModal() {
		const api = getDesktopApi();
		let modal = document.getElementById("bv-settings-modal");
		if (modal) {
			modal.style.display = "flex";
			return;
		}
		modal = document.createElement("div");
		modal.id = "bv-settings-modal";
		modal.style.cssText =
			"position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:2147483648;background:rgba(0,0,0,0.45);display:flex;align-items:center;justify-content:center;";
		modal.innerHTML = `
			<div style="background:#232428;padding:32px 28px 24px 28px;border-radius:12px;min-width:340px;max-width:90vw;box-shadow:0 8px 32px #0008;position:relative;display:flex;flex-direction:column;align-items:center;">
				<h2 style="margin-top:0;font-size:18px;color:#fff;">Settings</h2>
				<div style="margin-bottom:18px;width:100%;">
					<label style="display:flex;align-items:center;gap:8px;color:#dbdee1;font-size:14px;">
						<input type="checkbox" id="bv-setting-devtools" /> Enable DevTools
					</label>
				</div>
				<div style="margin-bottom:18px;width:100%;">
					<label style="display:flex;align-items:center;gap:8px;color:#dbdee1;font-size:14px;">
						<input type="checkbox" id="bv-setting-rpc" checked /> Enable Discord Rich Presence
					</label>
				</div>
				<div style="margin-bottom:18px;width:100%;">
					<button id="bv-update-btn" style="padding:6px 18px;border-radius:6px;background:#444;color:#fff;border:none;width:100%;">Check for Updates</button>
				</div>
				<button id="bv-settings-close" style="margin-top:8px;padding:6px 18px;border-radius:6px;background:#444;color:#fff;border:none;">Close</button>
			</div>
		`;
		document.body.appendChild(modal);
		modal.addEventListener("click", (e) => {
			if (e.target === modal) modal.style.display = "none";
		});
		document
			.getElementById("bv-settings-close")
			?.addEventListener("click", () => {
				modal.style.display = "none";
			});
		// Wire up settings logic (devtools, rpc toggle)
		const devtoolsCheckbox = document.getElementById(
			"bv-setting-devtools",
		) as HTMLInputElement;
		const rpcCheckbox = document.getElementById(
			"bv-setting-rpc",
		) as HTMLInputElement;
		devtoolsCheckbox.addEventListener("change", () => {
			if (api?.openDevTools) {
				api.openDevTools();
			}
		});
		rpcCheckbox.addEventListener("change", () => {
			if (api?.setRpcEnabled) {
				api.setRpcEnabled(rpcCheckbox.checked);
			}
		});
		// Update check button
		const updateBtn = document.getElementById("bv-update-btn");
		updateBtn?.addEventListener("click", async (event) => {
			event.preventDefault();
			event.stopPropagation();
			try {
				updateBtn.setAttribute("disabled", "true");
				if (api?.checkForUpdates) {
					await api.checkForUpdates();
				}
			} catch (err) {
				console.error("[BV] checkForUpdates failed", err);
			} finally {
				updateBtn.removeAttribute("disabled");
			}
		});
	}

	async function showAboutModal() {
		const api = getDesktopApi();
		let modal = document.getElementById("bv-about-modal");
		if (modal) {
			modal.style.display = "block";
		} else {
			const modalEl = document.createElement("div");
			modalEl.id = "bv-about-modal";
			modalEl.style.cssText =
				"position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:2147483648;background:rgba(0,0,0,0.45);display:flex;align-items:center;justify-content:center;";
			modalEl.innerHTML = `
				<div style="background:#232428;padding:32px 28px 24px 28px;border-radius:12px;min-width:340px;max-width:90vw;box-shadow:0 8px 32px #0008;position:relative;">
					<h2 style="margin-top:0;font-size:18px;color:#fff;">About</h2>
					<div id="bv-about-info" style="color:#dbdee1;font-size:14px;margin-bottom:18px;">
						Loading version info...
					</div>
					<button id="bv-about-close" style="margin-top:8px;padding:6px 18px;border-radius:6px;background:#444;color:#fff;border:none;">Close</button>
				</div>
			`;
			document.body.appendChild(modalEl);
			modalEl.addEventListener("click", (e) => {
				if (e.target === modalEl) modalEl.style.display = "none";
			});
			document
				.getElementById("bv-about-close")
				?.addEventListener("click", () => {
					modalEl.style.display = "none";
				});
			modal = modalEl;
		}
		const el = document.getElementById("bv-about-info");
		if (!el) return;
		if (!api?.getAboutInfo) {
			el.textContent = "Version info is unavailable.";
			return;
		}
		try {
			const info = await api.getAboutInfo();
			if (!info) {
				el.textContent = "Version info is unavailable.";
				return;
			}
			el.innerHTML = `
				<b>BrickVerse Guild Channels</b><br>
				Version: <b>${info.version}</b><br>
				Electron: <b>${info.electron}</b><br>
				Chromium: <b>${info.chrome}</b><br>
				Node.js: <b>${info.node}</b><br>
				V8: <b>${info.v8}</b><br>
				Platform: <b>${info.platform}</b> (${info.arch})<br>
			`;
		} catch (err) {
			console.error("[BV] getAboutInfo failed", err);
			el.textContent = "Failed to load version info.";
		}
	}
	const swallowMouseDown = (event: MouseEvent) => {
		event.preventDefault();
		event.stopPropagation();
	};
	for (const btn of [cloudBtn, minBtn, maxBtn, closeBtn]) {
		btn?.addEventListener("mousedown", swallowMouseDown);
	}
	cloudBtn?.addEventListener("click", async (event) => {
		event.preventDefault();
		event.stopPropagation();
		try {
			(cloudBtn as HTMLButtonElement).disabled = true;
			await windowControl("toggle-base-url");
			await syncCloudButton();
		} catch (err) {
			console.error("[BV] toggleBaseUrl failed", err);
		} finally {
			(cloudBtn as HTMLButtonElement).disabled = false;
		}
	});
	// Update check now only in settings modal
	minBtn?.addEventListener("click", async (event) => {
		event.preventDefault();
		event.stopPropagation();
		try {
			await windowControl("minimize");
		} catch (err) {
			console.error("[BV] minimize failed", err);
		}
	});
	maxBtn?.addEventListener("click", async (event) => {
		event.preventDefault();
		event.stopPropagation();
		try {
			await windowControl("toggle-maximize");
			await syncMaximizeButton();
		} catch (err) {
			console.error("[BV] toggleMaximize failed", err);
		}
	});
	closeBtn?.addEventListener("click", async (event) => {
		event.preventDefault();
		event.stopPropagation();
		try {
			await windowControl("close");
		} catch (err) {
			console.error("[BV] close failed", err);
		}
	});
	bar.addEventListener("dblclick", async (event) => {
		const target = event.target as Element;
		if (target instanceof Element && target.closest(".bv-titlebar-right"))
			return;
		await windowControl("toggle-maximize");
		await syncMaximizeButton();
	});
}

function startObservers() {
	if (observersStarted) return;
	observersStarted = true;
	new MutationObserver(() => {
		syncPageTitle();
	}).observe(document.head || document.documentElement, {
		childList: true,
		subtree: true,
		characterData: true,
	});
	new MutationObserver(() => {
		const bar = ensureTitlebar();
		bindEvents(bar as HTMLElement);
		applyAppOffset();
	}).observe(document.body || document.documentElement, {
		childList: true,
		subtree: false,
	});
	window.addEventListener("popstate", syncPageTitle);
	window.addEventListener("hashchange", syncPageTitle);
}

export function installDesktopTitlebar(desktopApi?: any) {
	console.log("[BV] installDesktopTitlebar start");
	if (desktopApi && typeof desktopApi === "object") {
		injectedDesktopApi = desktopApi;
	}
	if (!document.head || !document.documentElement) {
		console.log("[BV] document not ready");
		return;
	}
	ensureStyle();
	const bar = ensureTitlebar();
	bindEvents(bar as HTMLElement);
	applyAppOffset();
	syncPageTitle();
	// Only sync maximize/cloud if API is available
	if (window.bvDesktop) {
		syncMaximizeButton();
		syncCloudButton();
	}
	startObservers();
	if (keepAliveTimer) clearInterval(keepAliveTimer);
	keepAliveTimer = setInterval(() => {
		ensureTitlebar();
		applyAppOffset();
		syncPageTitle();
		if (window.bvDesktop) {
			syncMaximizeButton();
			syncCloudButton();
		}
	}, TITLE_REFRESH_MS);
	// Auto-check for updates on launch
	if (window.bvDesktop?.checkForUpdates) {
		window.bvDesktop.checkForUpdates();
	}
	console.log("[BV] titlebar installed");
}
