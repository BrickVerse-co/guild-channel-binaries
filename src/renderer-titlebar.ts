import { installDesktopTitlebar } from "./desktop-titlebar";

declare global {
	interface Window {
		bvDesktop?: any;
	}
}

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
