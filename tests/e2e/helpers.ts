import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { APIRequestContext, Page } from "@playwright/test";

export type TestUser = {
	id: string;
	email: string;
};

export const defaultUser: TestUser = {
	id: "user-1",
	email: "user@example.com",
};

export const mockAuthMe = async (page: Page, user: TestUser = defaultUser) => {
	await page.route("**/api/auth/me", async (route) => {
		await route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify({
				userId: user.id,
				email: user.email,
			}),
		});
	});
};

export const mockAuthMeUnauthorized = async (page: Page) => {
	await page.route("**/api/auth/me", async (route) => {
		await route.fulfill({
			status: 401,
			contentType: "application/json",
			body: JSON.stringify({
				error: { code: "UNAUTHORIZED", message: "Unauthorized" },
			}),
		});
	});
};

export async function pollUntil<T>(
	fn: () => Promise<T>,
	predicate: (value: T) => boolean,
	timeoutMs = 15000,
	intervalMs = 500,
): Promise<T> {
	const started = Date.now();
	let lastValue = await fn();
	while (!predicate(lastValue)) {
		if (Date.now() - started > timeoutMs) {
			return lastValue;
		}
		await new Promise((resolve) => setTimeout(resolve, intervalMs));
		lastValue = await fn();
	}
	return lastValue;
}

export async function getJson<T>(
	request: APIRequestContext,
	path: string,
): Promise<T> {
	const res = await request.get(path);
	if (!res.ok()) {
		throw new Error(`GET ${path} failed: ${res.status()} ${await res.text()}`);
	}
	return (await res.json()) as T;
}

const e2eDir = path.dirname(fileURLToPath(import.meta.url));
const testsDir = path.resolve(e2eDir, "..");

export async function readTestFixture(...segments: string[]) {
	return readFile(path.join(testsDir, "fixtures", ...segments), "utf8");
}
