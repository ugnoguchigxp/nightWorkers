import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppEnv } from "../api/lib/types";
import { errorHandler } from "../api/middleware/error-handler";

vi.mock("../api/config", () => {
	return {
		config: {
			AUTH_MODE: "both",
			GOOGLE_CLIENT_ID: "test-google-id",
			GOOGLE_CLIENT_SECRET: "test-google-secret",
			GITHUB_CLIENT_ID: "test-github-id",
			GITHUB_CLIENT_SECRET: "test-github-secret",
			APP_URL: "http://localhost:3000",
			NODE_ENV: "test",
			PORT: 39173,
			JWT_ACCESS_EXPIRES_IN: "15m",
			JWT_REFRESH_EXPIRES_IN: "7d",
		},
	};
});

const { exchangeCodeMock, getAuthorizationUrlMock } = vi.hoisted(() => {
	return {
		exchangeCodeMock: vi.fn(),
		getAuthorizationUrlMock: vi.fn(),
	};
});

vi.mock("../api/services/oauth/google", () => {
	return {
		GoogleOAuthClient: class {
			getAuthorizationUrl = getAuthorizationUrlMock;
			exchangeCode = exchangeCodeMock;
		},
	};
});

vi.mock("../api/services/oauth/github", () => {
	return {
		GitHubOAuthClient: class {
			getAuthorizationUrl = getAuthorizationUrlMock;
			exchangeCode = exchangeCodeMock;
		},
	};
});

const authServiceMocks = vi.hoisted(() => ({
	generateTokens: vi.fn(),
	handleExternalUser: vi.fn(),
}));

vi.mock("../api/services/auth.service", () => ({
	generateTokens: authServiceMocks.generateTokens,
	handleExternalUser: authServiceMocks.handleExternalUser,
}));

import { config } from "../api/config";
import { oauthRouter } from "../api/routes/oauth";

const getSetCookies = (res: Response): string[] => {
	const headers = res.headers as Headers & { getSetCookie?: () => string[] };
	const values = headers.getSetCookie?.();
	if (values && values.length > 0) return values;
	const fallback = res.headers.get("set-cookie");
	return fallback ? [fallback] : [];
};

describe("OAuth routes", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		config.AUTH_MODE = "both";
		getAuthorizationUrlMock.mockReturnValue("https://google-auth-url");
	});

	it("redirects to provider and sets oauth_state cookie on login route", async () => {
		const app = new OpenAPIHono<AppEnv>();
		app.onError(errorHandler);
		app.route("/api/auth/oauth", oauthRouter);

		const res = await app.request("/api/auth/oauth/google", { method: "GET" });

		expect(res.status).toBe(302);
		expect(res.headers.get("location")).toBe("https://google-auth-url");

		const cookies = getSetCookies(res);
		expect(cookies.some((c) => c.includes("oauth_state="))).toBe(true);
		expect(getAuthorizationUrlMock).toHaveBeenCalled();
	});

	it("throws AuthError if OAuth is disabled", async () => {
		config.AUTH_MODE = "local";

		const app = new OpenAPIHono<AppEnv>();
		app.onError(errorHandler);
		app.route("/api/auth/oauth", oauthRouter);

		const res = await app.request("/api/auth/oauth/google", { method: "GET" });
		expect(res.status).toBe(401);
		const json = await res.json();
		expect(json).toMatchObject({
			error: {
				code: "UNAUTHORIZED",
				message: "OAuth authentication is disabled",
			},
		});
	});

	it("throws ValidationError for invalid provider", async () => {
		const app = new OpenAPIHono<AppEnv>();
		app.onError(errorHandler);
		app.route("/api/auth/oauth", oauthRouter);

		const res = await app.request("/api/auth/oauth/facebook", {
			method: "GET",
		});
		expect(res.status).toBe(400);
		const json = await res.json();
		expect(json).toMatchObject({
			error: {
				code: "VALIDATION_ERROR",
				message: "Invalid or disabled OAuth provider",
			},
		});
	});

	it("callback succeeds, handles user, and redirects to frontend callback url", async () => {
		exchangeCodeMock.mockResolvedValue({
			user: { id: "g-123", email: "google@example.com", name: "Google Name" },
		});

		authServiceMocks.handleExternalUser.mockResolvedValue({
			id: "user-uuid",
			email: "google@example.com",
			isActive: true,
		});

		authServiceMocks.generateTokens.mockResolvedValue({
			accessToken: "acc",
			refreshToken: "ref",
		});

		const app = new OpenAPIHono<AppEnv>();
		app.onError(errorHandler);
		app.route("/api/auth/oauth", oauthRouter);

		const res = await app.request(
			"/api/auth/oauth/google/callback?code=code123&state=state123",
			{
				method: "GET",
				headers: {
					Cookie: "oauth_state=state123",
				},
			},
		);

		expect(res.status).toBe(302);
		expect(res.headers.get("location")).toBe(
			"http://localhost:3000/oauth/callback",
		);

		// Cookies should include rotated access_token and refresh_token, and cleared oauth_state
		const cookies = getSetCookies(res);
		expect(cookies.some((c) => c.includes("access_token=acc"))).toBe(true);
		expect(cookies.some((c) => c.includes("refresh_token=ref"))).toBe(true);
		expect(cookies.some((c) => c.includes("oauth_state=;"))).toBe(true);

		expect(exchangeCodeMock).toHaveBeenCalledWith("code123");
		expect(authServiceMocks.handleExternalUser).toHaveBeenCalledWith("google", {
			id: "g-123",
			email: "google@example.com",
			name: "Google Name",
		});
	});

	it("callback throws AuthError if state is missing or mismatched", async () => {
		const app = new OpenAPIHono<AppEnv>();
		app.onError(errorHandler);
		app.route("/api/auth/oauth", oauthRouter);

		const res = await app.request(
			"/api/auth/oauth/google/callback?code=code123&state=state-mismatch",
			{
				method: "GET",
				headers: {
					Cookie: "oauth_state=state-expected",
				},
			},
		);

		expect(res.status).toBe(401);
		const json = await res.json();
		expect(json).toMatchObject({
			error: { code: "UNAUTHORIZED", message: "Invalid state or code" },
		});
	});

	it("callback throws AuthError if user is blocked or inactive", async () => {
		exchangeCodeMock.mockResolvedValue({
			user: { id: "g-123", email: "google@example.com", name: "Google Name" },
		});

		authServiceMocks.handleExternalUser.mockResolvedValue({
			id: "user-uuid",
			email: "google@example.com",
			isActive: false,
		});

		const app = new OpenAPIHono<AppEnv>();
		app.onError(errorHandler);
		app.route("/api/auth/oauth", oauthRouter);

		const res = await app.request(
			"/api/auth/oauth/google/callback?code=code123&state=state123",
			{
				method: "GET",
				headers: {
					Cookie: "oauth_state=state123",
				},
			},
		);

		expect(res.status).toBe(401);
		const json = await res.json();
		expect(json).toMatchObject({
			error: { code: "UNAUTHORIZED", message: "Account blocked or inactive" },
		});
	});
});
