import { describe, expect, it } from "vitest";
import { blueprintCatalog } from "../shared/blueprint-catalog";

describe("Blueprint catalog", () => {
	it("includes Composia-derived component variants in the Blueprint catalog", () => {
		const catalogNames = new Set(
			blueprintCatalog.map((definition) => definition.name),
		);

		expect([...catalogNames]).toEqual(
			expect.arrayContaining([
				"ChartSection",
				"KanbanSection",
				"CalendarSection",
				"ScheduleSection",
				"MapSection",
				"ControlPanelSection",
				"NotificationCenterSection",
				"CheckoutSummarySection",
				"PaymentFormSection",
				"EmailInboxSection",
				"AnalyticsDashboardSection",
				"ChatPanelSection",
				"CodeEditorSection",
				"VideoSection",
				"BlogPostSection",
				"MediaTextSection",
				"FullBleedHeroSection",
				"TopMenuSection",
				"TabNavigationSection",
				"SidebarMenuSection",
				"LeftSidebarSection",
				"ExplorerSidebarSection",
				"RightSidebarLinksSection",
				"FooterNavigationSection",
			]),
		);
		expect(
			blueprintCatalog.find((definition) => definition.name === "ChartSection")
				?.variants,
		).toEqual(["bar", "line", "area", "pie", "radar"]);
		expect(
			blueprintCatalog.find((definition) => definition.name === "KanbanSection")
				?.variants,
		).toEqual(["kanban-board"]);
	});
});
