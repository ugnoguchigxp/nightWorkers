import type { AppType } from "@api/app";
import { hc } from "hono/client";
import { apiPath } from "./api-base";

let isRefreshing = false;
let apiAuthRequiredCache: boolean | null = null;
let refreshSubscribers: {
	resolve: () => void;
	reject: (error: Error) => void;
}[] = [];

const onRefreshed = () => {
	refreshSubscribers.forEach(({ resolve }) => {
		resolve();
	});
	refreshSubscribers = [];
};

const onRefreshFailed = (error: Error) => {
	refreshSubscribers.forEach(({ reject }) => {
		reject(error);
	});
	refreshSubscribers = [];
};

const addRefreshSubscriber = (subscriber: {
	resolve: () => void;
	reject: (error: Error) => void;
}) => {
	refreshSubscribers.push(subscriber);
};

const redirectToLoginIfNeeded = () => {
	if (window.location.pathname !== "/login") {
		window.location.href = "/login";
	}
};

function rewriteApiRequestUrl(rawUrl: string): string {
	try {
		const currentOrigin =
			typeof window !== "undefined" ? window.location.origin : undefined;
		const url = new URL(rawUrl, currentOrigin);
		if (url.pathname.startsWith("/api"))
			return apiPath(`${url.pathname}${url.search}`);
	} catch {
		if (rawUrl.startsWith("/api")) return apiPath(rawUrl);
	}
	return rawUrl;
}

function rewriteApiRequestInput(input: RequestInfo | URL): RequestInfo | URL {
	if (typeof input === "string") return rewriteApiRequestUrl(input);
	if (input instanceof URL) return rewriteApiRequestUrl(input.toString());
	if (typeof Request !== "undefined" && input instanceof Request) {
		return new Request(rewriteApiRequestUrl(input.url), input);
	}
	return input;
}

function requestUrlString(input: RequestInfo | URL): string {
	if (typeof input === "string") return input;
	if (input instanceof URL) return input.toString();
	if (typeof Request !== "undefined" && input instanceof Request)
		return input.url;
	return String(input);
}

async function isApiAuthRequired() {
	if (apiAuthRequiredCache !== null) return apiAuthRequiredCache;
	try {
		const res = await fetch(apiPath("/api/auth/methods"), {
			credentials: "include",
		});
		if (!res.ok) {
			apiAuthRequiredCache = false;
			return apiAuthRequiredCache;
		}
		const data = (await res.json()) as { apiAuthRequired?: boolean };
		apiAuthRequiredCache = Boolean(data.apiAuthRequired);
	} catch {
		apiAuthRequiredCache = false;
	}
	return apiAuthRequiredCache;
}

const customFetch = async (
	input: RequestInfo | URL,
	init?: RequestInit,
): Promise<Response> => {
	const requestInput = rewriteApiRequestInput(input);
	const newInit: RequestInit = {
		...init,
		credentials: "include",
		headers: {
			...init?.headers,
		},
	};

	let response = await fetch(requestInput, newInit);

	const urlString = requestUrlString(requestInput);
	const isRefreshEndpoint = urlString.includes("/auth/refresh");
	const isLoginEndpoint = urlString.includes("/auth/login");
	const isRegisterEndpoint = urlString.includes("/auth/register");
	const isLogoutEndpoint = urlString.includes("/auth/logout");
	const isMeEndpoint = urlString.includes("/auth/me");
	const isMethodsEndpoint = urlString.includes("/auth/methods");

	if (
		response.status === 401 &&
		!isRefreshEndpoint &&
		!isLoginEndpoint &&
		!isRegisterEndpoint &&
		!isLogoutEndpoint &&
		!isMeEndpoint &&
		!isMethodsEndpoint
	) {
		if (!(await isApiAuthRequired())) {
			return response;
		}

		if (!isRefreshing) {
			isRefreshing = true;
			try {
				const refreshRes = await fetch(apiPath("/api/auth/refresh"), {
					method: "POST",
					credentials: "include",
				});

				if (refreshRes.ok) {
					onRefreshed();
					response = await fetch(requestInput, newInit);
				} else {
					const error = new Error("Failed to refresh session");
					onRefreshFailed(error);
					redirectToLoginIfNeeded();
				}
			} catch (error) {
				onRefreshFailed(
					error instanceof Error
						? error
						: new Error("Failed to refresh session"),
				);
				redirectToLoginIfNeeded();
			} finally {
				isRefreshing = false;
			}
		} else {
			return new Promise((resolve, reject) => {
				addRefreshSubscriber({
					resolve: () => {
						resolve(fetch(requestInput, newInit));
					},
					reject,
				});
			});
		}
	}

	return response;
};

export const client = hc<AppType>("/api", {
	fetch: customFetch,
});
