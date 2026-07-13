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
				onOpenProjectDetailTab={vi.fn()}
				onRefresh={vi.fn()}
			/>,
		);
		expect(markup).toContain(
			'<option value="23d6c7d1-9780-4906-a074-0ea8a066f774" selected="">todolist</option>',
		);
	});

	it("puts project navigation in the header without the project title or dividers", () => {
		const markup = renderToStaticMarkup(
			<OverviewHeader
				projects={[]}
				range="30d"
				projectFilterId="23d6c7d1-9780-4906-a074-0ea8a066f774"
				projectName="todolist"
				isLoading={false}
				onRangeChange={vi.fn()}
				onProjectFilterChange={vi.fn()}
				onOpenProjectDetailTab={vi.fn()}
				onRefresh={vi.fn()}
			/>,
		);

		expect(markup).toContain("タスク生成");
		expect(markup).not.toContain("todolist の概要");
		expect(markup).not.toContain("border-bottom");
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

	it("fits hourly usage into the panel and renders time-only labels", () => {
		const hourlyUsage = renderUsage("24h");

		expect(hourlyUsage).toContain('class="min-w-0 border p-4"');
		expect(hourlyUsage).toContain(">21:00</span>");
		expect(hourlyUsage).not.toContain(">2026-07-11T21</span>");
	});

	it("limits usage chart details for long ranges", () => {
		const sevenDays = renderUsage("7d");
		const thirtyDays = renderUsage("30d");
		const allTime = renderUsage("all");

		expect(sevenDays).toContain("max-w-full truncate text-[9px]");
		expect(thirtyDays).toContain("日別使用量");
		expect(thirtyDays).not.toContain("max-w-full truncate text-[9px]");
		expect(allTime).not.toContain("日別使用量");
		expect(allTime).toContain("コスト概要");
	});

	it("shows the applied FX rate, refresh time, and recovery link", () => {
		const markup = renderToStaticMarkup(
			<OverviewUsageSections
				dashboard={
					{
						...usageDashboard,
						cost: {
							...usageDashboard.cost,
							fxRate: 156.25,
							fxBaseCurrency: "USD",
							fxUpdatedAt: "2026-07-13T00:00:00.000Z",
						},
						warnings: [{ code: "fx_unavailable" }],
					} as never
				}
				viewModel={usageViewModel as never}
				range="30d"
				language="ja"
				timezone="Asia/Tokyo"
				currency="JPY"
			/>,
		);

		expect(markup).toContain("USD から JPY: 156.2500");
		expect(markup).toContain("為替更新日時");
		expect(markup).toContain('href="/settings/general"');
		expect(markup).toContain("設定で為替情報を確認");
	});
});

function renderUsage(range: "24h" | "7d" | "30d" | "all") {
	return renderToStaticMarkup(
		<OverviewUsageSections
			dashboard={usageDashboard as never}
			viewModel={usageViewModel as never}
			range={range}
			language="ja"
			timezone="Asia/Tokyo"
			currency="JPY"
		/>,
	);
}

const usageDashboard = {
	generatedAt: "2026-07-11T00:00:00.000Z",
	dailyUsage: [
		{
			key: "2026-07-11T21",
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
		fxBaseCurrency: null,
		fxUpdatedAt: null,
	},
	warnings: [],
};

const usageViewModel = {
	maxBucketTokens: 9,
	hasDailyUsageData: true,
};
