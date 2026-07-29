import type { AppType } from "@api/app";
import { hc } from "hono/client";
import { apiPath } from "./api-base";

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

const customFetch = async (
	input: RequestInfo | URL,
	init?: RequestInit,
): Promise<Response> => {
	const requestInput = rewriteApiRequestInput(input);
	return fetch(requestInput, init);
};

export const client = hc<AppType>("/api", {
	fetch: customFetch,
});
