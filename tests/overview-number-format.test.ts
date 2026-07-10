import { describe, expect, it } from "vitest";
import {
	formatCompactCurrency,
	formatCompactNumber,
	formatExactNumber,
} from "../src/modules/overview/overviewFormat";

describe("Overview compact number formatting", () => {
	it.each([
		[0, "0"],
		[-0, "0"],
		[999, "999"],
		[1_000, "1K"],
		[1_500, "1.5K"],
		[1_750, "1.75K"],
		[999_999, "1M"],
		[1_000_000, "1M"],
		[8_382_845, "8.38M"],
		[1_250_000_000, "1.25G"],
		[1_000_000_000_000, "1T"],
		[1_000_000_000_000_000, "1P"],
	])("formats %s as %s", (value, expected) => {
		expect(formatCompactNumber(value)).toBe(expected);
	});

	it("handles invalid and exact values", () => {
		expect(formatCompactNumber(Number.NaN)).toBe("—");
		expect(formatCompactNumber(Number.POSITIVE_INFINITY)).toBe("—");
		expect(formatExactNumber(8_382_845, "ja")).toBe("8,382,845");
	});

	it("formats compact currency without changing small values", () => {
		expect(formatCompactCurrency(337, "JPY", "ja")).toBe("￥337");
		expect(formatCompactCurrency(2.08, "USD", "en")).toBe("$2.08");
		expect(formatCompactCurrency(1_750, "JPY", "ja")).toBe("￥1.75K");
		expect(formatCompactCurrency(1_250_000, "USD", "en")).toBe("$1.25M");
		expect(formatCompactCurrency(1_250_000, "EUR", "en")).toBe("€1.25M");
		expect(formatCompactCurrency(null, "JPY", "ja")).toBe("—");
	});

	it("uses the same two-decimal rule for percentages", () => {
		expect(formatCompactNumber(87.20590682518883)).toBe("87.21");
	});
});
