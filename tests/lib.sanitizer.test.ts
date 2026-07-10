import { describe, expect, it } from "vitest";
import { sanitize } from "../api/lib/sanitizer";

describe("sanitize", () => {
	it("removes html tags", () => {
		const input = "<script>alert(1)</script><b>hello</b>";
		expect(sanitize(input)).toBe("hello");
	});

	it("returns empty string as-is", () => {
		expect(sanitize("")).toBe("");
	});

	it.each([
		"<xmp><img src=x onerror=alert(1)></xmp>",
		"<script><script>alert(1)</script></script>",
		"<b>safe</div><img src=x onerror=alert(1)>",
	])("does not retain executable markup from %s", (input) => {
		const output = sanitize(input);
		expect(output).not.toMatch(/<(?:script|img|xmp)\b/i);
		expect(output).not.toContain("onerror=");
	});

	it("keeps encoded markup non-executable", () => {
		const output = sanitize("&lt;img src=x onerror=alert(1)&gt;");
		expect(output).not.toContain("<img");
	});

	it("preserves Japanese, emoji, and ordinary punctuation", () => {
		expect(sanitize("夜間ワーカー 🚀 — 安全です！ #1")).toBe(
			"夜間ワーカー 🚀 — 安全です！ #1",
		);
	});
});
