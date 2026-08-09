import { describe, expect, it } from "vitest";
import app from "../api/app";

describe("security scan app routing", () => {
	it("mounts provider settings and Project scan routes below /api", async () => {
		const settings = await app.request(
			"http://localhost/api/settings/vulnerability-scan-provider",
		);
		expect(settings.status, await settings.clone().text()).toBe(200);
		expect(await settings.json()).toEqual({
			enabled: false,
			transport: "local_cli",
			baseUrl: "http://127.0.0.1:29831",
			tokenConfigured: false,
			localCliConfigured: true,
		});

		const missingProject = await app.request(
			"http://localhost/api/repositories/missing/security-scans",
		);
		expect(missingProject.status).toBe(404);
		expect(await missingProject.json()).toMatchObject({
			error: { code: "NOT_FOUND" },
		});
	});
});
