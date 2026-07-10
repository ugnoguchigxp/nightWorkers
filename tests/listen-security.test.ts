import { describe, expect, it } from "vitest";
import {
	assessListenSecurity,
	isLoopbackHost,
} from "../api/security/listen-security";

const base = {
	nodeEnv: "production" as const,
	authRequired: false,
	corsOrigins: ["https://app.example.test"],
	trustProxy: false,
};

describe("listen security boundary", () => {
	it.each([
		"127.0.0.1",
		"127.12.3.4",
		"::1",
		"[::1]",
		"localhost",
	])("recognizes %s as loopback", (host) =>
		expect(isLoopbackHost(host)).toBe(true));

	it.each([
		"0.0.0.0",
		"10.0.0.4",
		"192.168.1.2",
		"203.0.113.8",
		"::",
	])("blocks unauthenticated production binding on %s", (host) => {
		const result = assessListenSecurity({ ...base, host });
		expect(result.status).toBe("fail");
		expect(result.productionBlocked).toBe(true);
		expect(result.detail).toContain("API_AUTH_REQUIRED=false");
	});

	it("allows explicit authenticated non-loopback binding", () => {
		const result = assessListenSecurity({
			...base,
			host: "0.0.0.0",
			authRequired: true,
			trustProxy: true,
		});
		expect(result.status).toBe("pass");
		expect(result.proxyHeadersTrusted).toBe(true);
	});

	it("requires an explicit acknowledgement for unauthenticated development binding", () => {
		const warning = assessListenSecurity({
			...base,
			nodeEnv: "development",
			host: "0.0.0.0",
		});
		const acknowledged = assessListenSecurity({
			...base,
			nodeEnv: "development",
			host: "0.0.0.0",
			allowInsecureNonLoopback: true,
		});
		expect(warning.status).toBe("warn");
		expect(warning.detail).toContain("ALLOW_INSECURE_NON_LOOPBACK=true");
		expect(acknowledged.status).toBe("pass");
		expect(acknowledged.detail).toContain("explicitly acknowledged");
	});
});
