import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createOpenApiRouter } from "../api/lib/openapi";
import { errorHandler } from "../api/middleware/error-handler";
import { securityScanRouter } from "../api/modules/securityScan/security-scan.routes";
import { clearSessionSecretStoreForTests } from "../api/services/security/os-secret-store";

const testState = vi.hoisted(() => ({
	repositoryId: "11111111-1111-4111-8111-111111111111",
	scanRunRef: "22222222-2222-4222-8222-222222222222",
	localPath: "/registered/project",
}));

vi.mock("../api/modules/nightworkers/nightworkers.repository", () => ({
	getRepository: vi.fn(async (repositoryId: string) =>
		repositoryId === testState.repositoryId
			? {
					id: repositoryId,
					name: "Test Project",
					localPath: testState.localPath,
					allowed: true,
				}
			: null,
	),
}));

const capabilities = {
	provider: { id: "vulnworkbench" as const, version: "1.0.0" },
	project: { ref: "provider-project", displayName: "Test Project" },
	presets: [
		{
			id: "standard" as const,
			displayName: "Standard",
			description: "Standard scan",
			recommended: true,
			targets: [
				{
					kind: "working_tree" as const,
					profileRef: "diff-basic-security",
					estimatedDurationSeconds: { min: 1, max: 5 },
					toolCategories: ["static"],
					warnings: [],
				},
			],
		},
	],
	selectableProfiles: [],
	limits: {
		maxConcurrentScansForClient: 2,
		maxFindingPageSize: 100,
		maxEventPageSize: 200,
		maxReportBytes: 5_242_880,
	},
};

function providerEnvelope(data: unknown) {
	return {
		contractVersion: 1,
		requestId: "request-1",
		data,
	};
}

function jsonResponse(data: unknown, status = 200) {
	return new Response(JSON.stringify(data), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

function app() {
	const router = createOpenApiRouter();
	router.onError(errorHandler);
	router.route("/", securityScanRouter);
	return router;
}

describe("security scan routes", () => {
	beforeEach(() => {
		clearSessionSecretStoreForTests();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		clearSessionSecretStoreForTests();
	});

	it("stores the token outside the response and forwards the registered path", async () => {
		const save = await app().request("/settings/vulnerability-scan-provider", {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				enabled: true,
				baseUrl: "http://127.0.0.1:29831",
				token: "secret-service-token",
			}),
		});
		expect(save.status).toBe(200);
		expect(await save.json()).toEqual({
			enabled: true,
			baseUrl: "http://127.0.0.1:29831",
			tokenConfigured: true,
		});

		const providerFetch = vi.fn(
			async (input: RequestInfo | URL, init?: RequestInit) => {
				expect(String(input)).toBe(
					"http://127.0.0.1:29831/api/integrations/nightworkers/v1/capabilities",
				);
				expect(new Headers(init?.headers).get("authorization")).toBe(
					"Bearer secret-service-token",
				);
				expect(JSON.parse(String(init?.body))).toEqual({
					projectPath: testState.localPath,
				});
				return jsonResponse(providerEnvelope(capabilities));
			},
		);
		vi.stubGlobal("fetch", providerFetch);

		const response = await app().request(
			`/repositories/${testState.repositoryId}/security-scans/capabilities`,
		);
		expect(response.status, await response.clone().text()).toBe(200);
		expect(await response.json()).toEqual(capabilities);
		expect(providerFetch).toHaveBeenCalledOnce();

		const read = await app().request("/settings/vulnerability-scan-provider");
		expect(await read.text()).not.toContain("secret-service-token");
	});

	it("persists the opaque scan binding and exposes it as Project history", async () => {
		await app().request("/settings/vulnerability-scan-provider", {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				enabled: true,
				baseUrl: "http://127.0.0.1:29831",
				token: "secret-service-token",
			}),
		});
		const createdAt = "2026-07-30T04:00:00.000Z";
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				jsonResponse(
					providerEnvelope({
						scanRunRef: testState.scanRunRef,
						status: "queued",
						resolvedProfileRef: "diff-basic-security",
						target: {
							kind: "working_tree",
							digest: "a".repeat(64),
							sourceRevision: "abc123",
						},
						createdAt,
						replayed: false,
					}),
					202,
				),
			),
		);

		const response = await app().request(
			`/repositories/${testState.repositoryId}/security-scans`,
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"Idempotency-Key": "33333333-3333-4333-8333-333333333333",
				},
				body: JSON.stringify({
					selection: { mode: "preset", presetId: "standard" },
					target: { kind: "working_tree" },
					previewRef: "preview-ref",
					expectedTargetDigest: "a".repeat(64),
				}),
			},
		);
		expect(response.status, await response.clone().text()).toBe(202);

		const history = await app().request(
			`/repositories/${testState.repositoryId}/security-scans`,
		);
		expect(await history.json()).toEqual({
			items: [
				{
					scanRunRef: testState.scanRunRef,
					selection: { mode: "preset", presetId: "standard" },
					target: { kind: "working_tree" },
					createdAt,
				},
			],
		});
	});

	it("rejects a non-loopback plaintext provider URL", async () => {
		const response = await app().request(
			"/settings/vulnerability-scan-provider",
			{
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					enabled: true,
					baseUrl: "http://scanner.example.com",
					token: "secret-service-token",
				}),
			},
		);
		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({
			error: { code: "VALIDATION_ERROR" },
		});
	});

	it("rejects unbound scan refs before contacting the provider", async () => {
		const providerFetch = vi.fn();
		vi.stubGlobal("fetch", providerFetch);
		const response = await app().request(
			`/repositories/${testState.repositoryId}/security-scans/44444444-4444-4444-8444-444444444444`,
		);
		expect(response.status).toBe(404);
		expect(providerFetch).not.toHaveBeenCalled();
	});
});
