import { session } from "electron";

/**
 * Fetch a BrickVerse API endpoint using the authenticated browser session.
 *
 * Development API requests target 127.0.0.1, so cookies issued by the website
 * or production API are not automatically in scope. Keep the HttpOnly token in
 * the main process and forward it through the backend's supported Bearer scheme.
 */
export async function authenticatedApiFetch(
	url: string,
	init: RequestInit = {},
): Promise<Response> {
	const headers = new Headers(init.headers);
	let hasAuthCookie = headers.has("Authorization");
	if (!headers.has("Authorization")) {
		const cookies = await session.defaultSession.cookies.get({ name: "auth_token" });
		const authCookie = cookies
			.filter((cookie) => Boolean(cookie.value))
			.sort((a, b) => (b.expirationDate || Number.MAX_SAFE_INTEGER) - (a.expirationDate || Number.MAX_SAFE_INTEGER))[0];
		if (authCookie) {
			headers.set("Authorization", `Bearer ${authCookie.value}`);
			hasAuthCookie = true;
		}
	}
	const method = init.method || "GET";
	try {
		const response = await session.defaultSession.fetch(url, {
			...init,
			headers,
			credentials: "include",
		});
		if (!response.ok) {
			const body = await response.clone().text().catch(() => "");
			console.warn(
				`[BV][HTTP] ${method} ${url} -> ${response.status} (auth cookie: ${hasAuthCookie ? "present" : "missing"})${body ? `: ${body.slice(0, 500)}` : ""}`,
			);
		}
		return response;
	} catch (error) {
		console.warn(
			`[BV][HTTP] ${method} ${url} failed (auth cookie: ${hasAuthCookie ? "present" : "missing"}):`,
			error,
		);
		throw error;
	}
}
