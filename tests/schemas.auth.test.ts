import { describe, expect, it } from "vitest";
import { loginSchema, registerSchema } from "../shared/schemas/auth.schema";

describe("auth schemas", () => {
	it("validates and sanitizes register payload", () => {
		const payload = registerSchema.parse({
			email: "user@example.com",
			password: "password123",
			name: "<b>Alice</b>",
		});

		expect(payload.email).toBe("user@example.com");
		expect(payload.name).toBe("Alice");
	});

	it("rejects short register password", () => {
		expect(() =>
			registerSchema.parse({
				email: "user@example.com",
				password: "short",
				name: "Alice",
			}),
		).toThrow();
	});

	it("removes raw-text and nested executable markup from registration names", () => {
		const payload = registerSchema.parse({
			email: "safe@example.com",
			password: "password123",
			name: "利用者<xmp><img src=x onerror=alert(1)></xmp>🚀",
		});

		expect(payload.name).toBe("利用者🚀");
	});

	it("validates login payload", () => {
		expect(
			loginSchema.parse({
				email: "user@example.com",
				password: "p",
			}),
		).toEqual({
			email: "user@example.com",
			password: "p",
		});
	});
});
