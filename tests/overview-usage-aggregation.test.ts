import { describe, expect, it } from "vitest";
import {
	addAggregateUsage,
	emptyBucket,
	emptyUsageSummary,
	fillBuckets,
	getBucketKey,
	mergePricingStatus,
} from "../api/modules/overview/overview-usage-aggregation";

describe("Overview usage aggregation", () => {
	it("keeps incomplete model pricing visible", () => {
		expect(mergePricingStatus("priced", "missing")).toBe("missing");
		expect(mergePricingStatus("manual", "priced")).toBe("manual");
		expect(mergePricingStatus("priced", "ambiguous")).toBe("ambiguous");
	});

	it("clamps cached reads per aggregate row before summing", () => {
		const total = emptyUsageSummary();

		addAggregateUsage(total, {
			inputTokens: 10,
			cachedInputTokens: 20,
			outputTokens: 3,
		});

		expect(total).toMatchObject({
			inputTokens: 10,
			cachedInputTokens: 10,
			outputTokens: 3,
		});
	});

	it("fills missing buckets without discarding recorded usage", () => {
		const now = new Date("2026-07-10T12:00:00.000Z");
		const recorded = emptyBucket({
			key: "2026-07-08",
			startsAt: "2026-07-08T00:00:00",
			endsAt: "2026-07-08T23:59:59",
		});
		recorded.inputTokens = 1_000;

		const buckets = fillBuckets([recorded], "7d", "UTC", now);

		expect(buckets).toHaveLength(7);
		expect(buckets.map((bucket) => bucket.key)).toEqual([
			"2026-07-04",
			"2026-07-05",
			"2026-07-06",
			"2026-07-07",
			"2026-07-08",
			"2026-07-09",
			"2026-07-10",
		]);
		expect(
			buckets.find((bucket) => bucket.key === "2026-07-08")?.inputTokens,
		).toBe(1_000);
	});

	it("uses the actual last day for all-time monthly buckets", () => {
		expect(
			getBucketKey(new Date("2024-02-10T00:00:00.000Z"), "all", "UTC"),
		).toEqual({
			key: "2024-02",
			startsAt: "2024-02-01T00:00:00",
			endsAt: "2024-02-29T23:59:59",
		});
	});

	it("does not discard a partial cutoff-day bucket", () => {
		const now = new Date("2026-07-10T12:00:00.000Z");
		const cutoffDay = emptyBucket({
			key: "2026-07-03",
			startsAt: "2026-07-03T00:00:00",
			endsAt: "2026-07-03T23:59:59",
		});
		cutoffDay.outputTokens = 50;

		const buckets = fillBuckets([cutoffDay], "7d", "UTC", now);

		expect(buckets).toHaveLength(8);
		expect(buckets[0]).toMatchObject({
			key: "2026-07-03",
			outputTokens: 50,
		});
	});

	it("fills missing all-time months through the current month", () => {
		const now = new Date("2026-03-10T00:00:00.000Z");
		const january = emptyBucket({
			key: "2026-01",
			startsAt: "2026-01-01T00:00:00",
			endsAt: "2026-01-31T23:59:59",
		});
		january.callCount = 1;

		const buckets = fillBuckets([january], "all", "UTC", now);

		expect(buckets.map((bucket) => bucket.key)).toEqual([
			"2026-01",
			"2026-02",
			"2026-03",
		]);
		expect(buckets[0].callCount).toBe(1);
	});
});
