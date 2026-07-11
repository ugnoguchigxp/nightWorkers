import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import "../src/i18n/setup";
import { OverviewHeader } from "../src/modules/overview/components/OverviewHeader";
import { CompactCostValue } from "../src/modules/overview/components/OverviewPrimitives";
import { OverviewUsageSections } from "../src/modules/overview/components/OverviewUsageSections";

describe("Overview components", () => {
	it("keeps a URL-selected project visible while the project list is loading", () => {
		const markup = renderToStaticMarkup(
			<OverviewHeader
				projects={[]}
				range="30d"
				projectFilterId="23d6c7d1-9780-4906-a074-0ea8a066f774"
				projectName="todolist"
				isLoading={false}
				onRangeChange={vi.fn()}
				onProjectFilterChange={vi.fn()}
				onRefresh={vi.fn()}
			/>,
		);
		expect(markup).toContain(
			'<option value="23d6c7d1-9780-4906-a074-0ea8a066f774" selected="">todolist</option>',
		);
	});

	it("renders credits without presenting them as configured currency", () => {
		const markup = renderToStaticMarkup(
			<CompactCostValue
				estimatedCost={null}
				estimatedCredits={1_750}
				currency="JPY"
				language="ja"
			/>,
		);
		expect(markup).toContain("1.75K クレジット");
		expect(markup).not.toContain("￥");
	});

	it("renders mixed currency and credit costs on separate lines", () => {
		const markup = renderToStaticMarkup(
			<CompactCostValue
				estimatedCost={1_250}
				estimatedCredits={2_500}
				currency="USD"
				language="en"
			/>,
		);
		expect(markup).toContain("$1.25K");
		expect(markup).toContain("2.5K credits");
	});

	it("does not expose a zero-credit suffix for currency-only models", () => {
		const markup = renderToStaticMarkup(
			<CompactCostValue
				estimatedCost={337}
				estimatedCredits={0}
				currency="JPY"
				language="ja"
			/>,
		);
		expect(markup).toContain("￥337");
		expect(markup).not.toContain("クレジット");
	});

	it("limits usage chart details for long ranges", () => {
		const renderUsage = (range: "7d" | "30d" | "all") =>
			renderToStaticMarkup(
				<OverviewUsageSections
					dashboard={usageDashboard as never}
					viewModel={usageViewModel as never}
					range={range}
					language="ja"
					timezone="Asia/Tokyo"
					currency="JPY"
				/>,
			);

		const sevenDays = renderUsage("7d");
		const thirtyDays = renderUsage("30d");
		const allTime = renderUsage("all");

		expect(sevenDays).toContain("max-w-full truncate text-[9px]");
		expect(thirtyDays).toContain("日別使用量");
		expect(thirtyDays).not.toContain("max-w-full truncate text-[9px]");
		expect(allTime).not.toContain("日別使用量");
		expect(allTime).toContain("コスト概要");
	});
});

const usageDashboard = {
	generatedAt: "2026-07-11T00:00:00.000Z",
	dailyUsage: [
		{
			key: "2026-07-11",
			inputTokens: 10,
			cachedInputTokens: 2,
			outputTokens: 1,
		},
	],
	cost: {
		inputCost: 1,
		cachedInputCost: 1,
		outputCost: 1,
		creditTotal: null,
		fxRate: null,
	},
	warnings: [],
};

const usageViewModel = {
	maxBucketTokens: 9,
	hasDailyUsageData: true,
};
