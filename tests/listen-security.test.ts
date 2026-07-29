import { describe, expect, it } from "vitest";
import {
	assessListenSecurity,
	isLoopbackHost,
} from "../api/security/listen-security";

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
	])("rejects non-loopback host %s", (host) => {
		const result = assessListenSecurity({
			host,
			corsOrigins: ["http://localhost:39174"],
		});
		expect(result.status).toBe("fail");
		expect(result.loopback).toBe(false);
		expect(result.detail).toContain("only supports local listeners");
	});

	it("accepts a loopback listener", () => {
		const result = assessListenSecurity({
			host: "127.0.0.1",
			corsOrigins: ["http://localhost:39174"],
		});
		expect(result.status).toBe("pass");
		expect(result.loopback).toBe(true);
	});
});
