import type { IncomingMessage } from "node:http";
import { Readable } from "node:stream";
import { gzipSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import {
	isPublicOutboundAddress,
	type SafeOutboundPinnedResponse,
	safeOutboundFetch,
} from "../api/services/security/safe-outbound-fetch";

function pinnedResponse(
	input: {
		status?: number;
		headers?: Record<string, string>;
		body?: Uint8Array;
	} = {},
): SafeOutboundPinnedResponse {
	const stream = Readable.from(
		input.body ? [input.body] : [],
	) as IncomingMessage;
	Object.assign(stream, {
		statusCode: input.status ?? 200,
		headers: input.headers ?? {},
	});
	return { response: stream, dispose: vi.fn() };
}

const publicResolver = vi
	.fn()
	.mockResolvedValue([{ address: "8.8.8.8", family: 4 as const }]);

describe("isPublicOutboundAddress", () => {
	it.each([
		["8.8.8.8", true],
		["127.0.0.1", false],
		["10.0.0.1", false],
		["169.254.169.254", false],
		["192.168.1.1", false],
		["192.0.2.1", false],
		["224.0.0.1", false],
		["::1", false],
		["fc00::1", false],
		["fe80::1", false],
		["::ffff:127.0.0.1", false],
		["2606:4700:4700::1111", true],
	])("classifies %s as public=%s", (address, expected) => {
		expect(isPublicOutboundAddress(address)).toBe(expected);
	});
});

describe("safeOutboundFetch resolver and transport boundary", () => {
	it("rejects a mixed public/private DNS answer before opening a connection", async () => {
		const requestPinnedUrl = vi.fn();
		await expect(
			safeOutboundFetch(
				{ url: "https://example.test/private" },
				{
					resolveAddresses: async () => [
						{ address: "8.8.8.8", family: 4 },
						{ address: "127.0.0.1", family: 4 },
					],
					requestPinnedUrl,
				},
			),
		).rejects.toMatchObject({ code: "OUTBOUND_DNS_DENIED" });
		expect(requestPinnedUrl).not.toHaveBeenCalled();
	});

	it("pins the vetted DNS address for the transport request", async () => {
		const requestPinnedUrl = vi.fn().mockResolvedValue(
			pinnedResponse({
				headers: { "content-type": "text/plain" },
				body: Buffer.from("ok"),
			}),
		);
		const result = await safeOutboundFetch(
			{ url: "https://rebindable.example.test/resource" },
			{ resolveAddresses: publicResolver, requestPinnedUrl },
		);
		expect(requestPinnedUrl).toHaveBeenCalledWith(
			expect.objectContaining({ address: { address: "8.8.8.8", family: 4 } }),
		);
		expect(await result.response.text()).toBe("ok");
	});

	it("re-validates redirects and rejects a redirect to a loopback address", async () => {
		const requestPinnedUrl = vi.fn().mockResolvedValue(
			pinnedResponse({
				status: 302,
				headers: { location: "http://127.0.0.1/private" },
			}),
		);
		await expect(
			safeOutboundFetch(
				{ url: "https://example.test/redirect" },
				{ resolveAddresses: publicResolver, requestPinnedUrl },
			),
		).rejects.toMatchObject({ code: "OUTBOUND_ADDRESS_DENIED" });
		expect(requestPinnedUrl).toHaveBeenCalledTimes(1);
	});

	it("enforces the redirect limit", async () => {
		let redirect = 0;
		const requestPinnedUrl = vi.fn().mockImplementation(() => {
			redirect += 1;
			return pinnedResponse({
				status: 302,
				headers: { location: `/redirect-${redirect}` },
			});
		});
		await expect(
			safeOutboundFetch(
				{ url: "https://example.test/redirect-0", maxRedirects: 1 },
				{ resolveAddresses: publicResolver, requestPinnedUrl },
			),
		).rejects.toMatchObject({ code: "OUTBOUND_REDIRECT_LIMIT" });
		expect(requestPinnedUrl).toHaveBeenCalledTimes(2);
	});

	it("counts decoded bytes when enforcing the response-size limit", async () => {
		const requestPinnedUrl = vi.fn().mockResolvedValue(
			pinnedResponse({
				headers: { "content-encoding": "gzip" },
				body: gzipSync(Buffer.alloc(128, "x")),
			}),
		);
		await expect(
			safeOutboundFetch(
				{ url: "https://example.test/compressed", maxResponseBytes: 32 },
				{ resolveAddresses: publicResolver, requestPinnedUrl },
			),
		).rejects.toMatchObject({ code: "OUTBOUND_RESPONSE_TOO_LARGE" });
	});

	it("rejects an already-aborted request before DNS resolution or transport", async () => {
		const controller = new AbortController();
		controller.abort();
		const resolveAddresses = vi.fn();
		const requestPinnedUrl = vi.fn();
		await expect(
			safeOutboundFetch(
				{ url: "https://example.test/aborted", signal: controller.signal },
				{ resolveAddresses, requestPinnedUrl },
			),
		).rejects.toMatchObject({ code: "OUTBOUND_ABORTED" });
		expect(resolveAddresses).not.toHaveBeenCalled();
		expect(requestPinnedUrl).not.toHaveBeenCalled();
	});
});
