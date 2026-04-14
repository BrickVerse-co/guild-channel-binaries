const TITLEBAR_HEIGHT = 38;
const TITLEBAR_ID = "bv-desktop-titlebar";
const STYLE_ID = "bv-desktop-titlebar-style";
const ROOT_ATTR = "data-bv-titlebar-padded";
const TITLE_REFRESH_MS = 1000;
const CLOUD_ICON_SVG =
	'<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M5.5 12.5h5.75a2.75 2.75 0 0 0 .35-5.48A4.25 4.25 0 0 0 3.5 8.2 2.3 2.3 0 0 0 5.5 12.5Z" /></svg>';
const MAXIMIZE_ICON_SVG =
	'<svg viewBox="0 0 12 12" aria-hidden="true" focusable="false"><rect x="2" y="2" width="8" height="8" rx="0.5" ry="0.5" /></svg>';
const RESTORE_ICON_SVG =
	'<svg viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="M4 2h6v6" /><path d="M8 4H2v6h6z" /></svg>';

let observersStarted = false;
let keepAliveTimer = null;
let injectedDesktopApi = null;

function getDesktopApi() {
	if (injectedDesktopApi) {
		return injectedDesktopApi;
	}

	if (!window.bvDesktop) {
		console.error("[BV] window.bvDesktop is unavailable");
		return null;
	}

	return window.bvDesktop;
}

async function windowControl(action) {
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

	#${TITLEBAR_ID} * {
		box-sizing: border-box;
	}

	.bv-titlebar-left,
	.bv-titlebar-center,
	.bv-titlebar-right {
		height: 100%;
		display: flex;
		align-items: center;
	}

	.bv-titlebar-left,
	.bv-titlebar-center {
		-webkit-app-region: drag;
	}

	.bv-titlebar-left {
		padding: 0 12px;
		flex: 0 0 auto;
	}

	.bv-titlebar-logo {
		height: 20px;
		width: auto;
		display: block;
		pointer-events: none;
	}

	.bv-titlebar-center {
		justify-content: center;
		overflow: hidden;
		padding: 0 16px;
		min-width: 0;
		flex: 1 1 auto;
		pointer-events: none;
	}

	#bv-titlebar-page-title {
		color: #dbdee1;
		font-size: 13px;
		font-weight: 600;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 60vw;
		text-align: center;
	}

	.bv-titlebar-right {
		-webkit-app-region: no-drag;
		margin-left: auto;
		z-index: 2;
		flex: 0 0 auto;
	}

	.bv-titlebar-btn {
		width: 46px;
		height: 100%;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border: 0;
		background: transparent;
		color: #b5bac1;
		cursor: pointer;
		font-size: 14px;
		line-height: 1;
		-webkit-app-region: no-drag;
		pointer-events: auto;
		padding: 0;
	}

	.bv-titlebar-btn.bv-cloud-btn {
		width: auto;
		gap: 6px;
		padding: 0 12px;
		font-size: 11px;
		font-weight: 700;
		letter-spacing: 0.08em;
	}

	.bv-titlebar-btn.bv-cloud-btn svg {
		width: 14px;
		height: 14px;
	}

	.bv-titlebar-btn.bv-cloud-btn.is-local {
		color: #6ee7b7;
	}

	.bv-titlebar-btn.bv-cloud-btn.is-live {
		color: #93c5fd;
	}

	.bv-titlebar-env-label {
		min-width: 34px;
		text-align: left;
	}

	.bv-titlebar-btn svg {
		width: 12px;
		height: 12px;
		display: block;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.2;
		shape-rendering: geometricPrecision;
	}

	.bv-titlebar-btn:hover {
		background: rgba(255,255,255,0.08);
		color: #fff;
	}

	.bv-titlebar-btn.bv-close:hover {
		background: #da373c;
	}
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
			<img
				class="bv-titlebar-logo"
				src="https://brickverse.gg/img/brand/light_long.png"
				alt="BrickVerse"
			/>
		</div>

		<div class="bv-titlebar-center">
			<div id="bv-titlebar-page-title">BrickVerse</div>
		</div>

		<div class="bv-titlebar-right">
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

function bindEvents(bar) {
	if (!bar || bar.dataset.bound === "1") return;
	bar.dataset.bound = "1";

	const minBtn = document.getElementById("bv-min-btn");
	const maxBtn = document.getElementById("bv-max-btn");
	const closeBtn = document.getElementById("bv-close-btn");
	const cloudBtn = document.getElementById("bv-cloud-btn");

	const swallowMouseDown = (event) => {
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
			cloudBtn.disabled = true;
			await windowControl("toggle-base-url");
			await syncCloudButton();
		} catch (err) {
			console.error("[BV] toggleBaseUrl failed", err);
		} finally {
			cloudBtn.disabled = false;
		}
	});

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
		const target = event.target;
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
		bindEvents(bar);
		applyAppOffset();
	}).observe(document.body || document.documentElement, {
		childList: true,
		subtree: false,
	});

	window.addEventListener("popstate", syncPageTitle);
	window.addEventListener("hashchange", syncPageTitle);
}

function installDesktopTitlebar(desktopApi) {
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
	bindEvents(bar);
	applyAppOffset();
	syncPageTitle();
	syncMaximizeButton();
	syncCloudButton();
	startObservers();

	if (keepAliveTimer) clearInterval(keepAliveTimer);
	keepAliveTimer = setInterval(() => {
		ensureTitlebar();
		applyAppOffset();
		syncPageTitle();
		syncMaximizeButton();
		syncCloudButton();
	}, TITLE_REFRESH_MS);

	console.log("[BV] titlebar installed");
}

module.exports = {
	installDesktopTitlebar,
};
