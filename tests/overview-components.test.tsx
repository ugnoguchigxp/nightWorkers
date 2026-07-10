import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import "../src/i18n/setup";
import { OverviewHeader } from "../src/modules/overview/components/OverviewHeader";
import { CompactCostValue } from "../src/modules/overview/components/OverviewPrimitives";

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
});
