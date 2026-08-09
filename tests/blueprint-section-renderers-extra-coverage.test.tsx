import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { renderAdditionalPreviewSectionBody } from "../src/modules/blueprint-preview/BlueprintPreviewSectionMore";
import {
	analyticsDashboardChartData,
	buildKanbanColumns,
	kanbanAccentClass,
} from "../src/modules/blueprint-preview/section-renderers/helpers";

const componentNames = [
	"ChartSection",
	"DataTableSection",
	"ImageSection",
	"VideoSection",
	"BlogPostSection",
	"MediaTextSection",
	"SplitHeroSection",
	"FullBleedHeroSection",
	"CarouselSection",
	"FormSection",
	"KanbanSection",
	"CardGridSection",
	"CalendarSection",
	"ScheduleSection",
	"MapSection",
	"CheckoutSummarySection",
	"PaymentFormSection",
	"EmailInboxSection",
	"AnalyticsDashboardSection",
	"TopMenuSection",
	"TabNavigationSection",
	"SidebarMenuSection",
	"LeftSidebarSection",
	"ExplorerSidebarSection",
	"RightSidebarLinksSection",
	"FooterNavigationSection",
	"ChatPanelSection",
	"NotificationCenterSection",
	"TimelineSection",
	"CodeEditorSection",
	"AccordionSection",
	"ComparisonSection",
	"ControlPanelSection",
] as const;

const t = ((key: string, options?: Record<string, unknown>) =>
	options?.title ? `${key}:${options.title}` : key) as never;

describe("blueprint section renderers extra coverage", () => {
	it.each(
		componentNames,
	)("renders default and rich %s variants", (componentName) => {
		const defaultMarkup = render(componentName, {});
		const richMarkup = render(componentName, richProps());

		expect(defaultMarkup.length).toBeGreaterThan(5);
		expect(richMarkup.length).toBeGreaterThan(5);
	});

	it("returns null for an unknown component", () => {
		expect(
			renderAdditionalPreviewSectionBody({
				componentName: "UnknownSection",
				props: {},
				t,
			}),
		).toBeNull();
	});

	it("covers helper fallback, matching, numeric, and accent branches", () => {
		const columns = buildKanbanColumns(
			{
				columns: [
					{ id: "todo", title: "Todo" },
					{ key: "doing", label: "Doing" },
					{ name: "Done" },
					{ title: "Later" },
				],
				cards: [
					{ title: "No status" },
					{ title: "By id", columnId: "todo" },
					{ title: "By key", column: "DOING" },
					{ title: "By name", status: "done" },
					{ title: "By title", stage: "later" },
				],
			},
			t,
		);
		expect(columns.map((column) => column.cards.length)).toEqual([2, 1, 1, 1]);

		const defaults = buildKanbanColumns({ columns: [{}, {}, {}, {}] }, t);
		expect(defaults).toHaveLength(4);
		expect(defaults[3]?.cards[0]).toMatchObject({
			badge: "Done",
			assignee: "QA",
		});
		expect(
			buildKanbanColumns({ cards: [{ title: "Only" }] }, t)[0]?.cards,
		).toHaveLength(1);
		expect(buildKanbanColumns({}, t)).toHaveLength(3);
		expect(kanbanAccentClass(7)).toBe("bg-emerald-400");

		expect(
			analyticsDashboardChartData({
				chartData: [
					{ label: "A", value: 3 },
					{ title: "B", sales: "4" },
					{ time: "C", count: "invalid" },
					{ date: "D", total: 6 },
					{},
				],
			}),
		).toEqual([
			{ label: "A", value: 3 },
			{ label: "B", value: 4 },
			{ label: "C", value: 42 },
			{ label: "D", value: 6 },
			{ label: "Point 5", value: 60 },
		]);
		expect(analyticsDashboardChartData({})).toHaveLength(10);
	});
});

function render(componentName: string, props: Record<string, unknown>) {
	return renderToStaticMarkup(
		renderAdditionalPreviewSectionBody({ componentName, props, t }),
	);
}

function richProps(): Record<string, unknown> {
	const items = [
		{
			id: "one",
			title: "Primary",
			label: "Primary label",
			name: "Primary name",
			description: "Detailed description",
			body: "Body text",
			content: "Content text",
			caption: "Caption",
			value: 42,
			amount: "$42",
			status: "active",
			badge: "new",
			tag: "tag",
			priority: "high",
			owner: "Owner",
			assignee: "Assignee",
			dueDate: "Tomorrow",
			updatedAt: "Now",
			date: "2026-08-09",
			time: "10:00",
			location: "Tokyo",
			actor: "Agent",
			author: "Author",
			action: "updated",
			target: "artifact",
			role: "assistant",
			text: "Message",
			sender: "Sender",
			from: "sender@example.com",
			subject: "Subject",
			category: "Category",
			type: "text",
			distance: "1 km",
			imageUrl: "data:image/gif;base64,R0lGODlhAQABAAAAACw=",
			alt: "Preview",
			points: ["One", "Two"],
		},
		{
			id: "two",
			title: "Secondary",
			description: "Secondary description",
			value: "invalid",
			status: "done",
			side: "right",
			checked: true,
		},
	];
	return {
		title: "Rich section",
		headline: "Rich headline",
		name: "Rich name",
		subtitle: "Subtitle",
		description: "Description",
		body: "First paragraph\n\nSecond paragraph",
		content: items,
		caption: "Caption",
		label: "Label",
		brand: "NightWorkers",
		author: "Author",
		date: "2026-08-09",
		readingTime: "5 min",
		quote: "Quoted text",
		tags: ["One", { label: "Two" }, 0, null],
		items,
		cards: items,
		products: items,
		slides: items,
		messages: items,
		notifications: items,
		metrics: items,
		events: items,
		entries: items,
		steps: items,
		locations: items,
		lines: ["const value = 1;", { text: "return value;" }],
		fields: [
			{ label: "Name", type: "text", placeholder: "Your name" },
			{ label: "Plan", type: "select", value: "Pro" },
			{ label: "Remember", type: "checkbox", checked: true },
			{ label: "Notes", type: "textarea" },
		],
		controls: [
			{ label: "Enabled", value: true, mode: "toggle" },
			{ title: "Progress", progress: 70 },
		],
		columns: [
			{ key: "title", label: "Title", cards: items },
			{ key: "status", label: "Status", cards: [] },
		],
		rows: items,
		filters: [{ label: "All" }, { title: "Open" }, { name: "Done" }, {}],
		groups: [
			{ title: "Group", items },
			{ label: "Links", links: items },
		],
		footerColumns: [
			{ title: "Product", links: items },
			{ label: "Company", links: items },
		],
		tree: [
			{ label: "src", children: [{ label: "index.ts" }] },
			{ label: "README" },
		],
		chartData: items,
		series: items,
		paragraphs: ["Paragraph", { text: "Object paragraph" }, 0],
		highlights: ["Fast", { title: "Safe" }],
		bullets: items,
		actions: [{ label: "Primary" }, { title: "Secondary" }],
		primaryCta: "Start",
		secondaryCta: "Learn",
		imagePosition: "right",
		mediaPosition: "left",
		posterUrl: "data:image/gif;base64,R0lGODlhAQABAAAAACw=",
		duration: "2:00",
		monthLabel: "August 2026",
		searchPlaceholder: "Search",
		zoomLabel: "Zoom",
		boardLabel: "Board",
		boardDescription: "Board description",
		submitLabel: "Submit",
		actionLabel: "Pay",
		amount: "$99",
		total: "$100",
		placeholder: "Write a message",
		panelTitle: "Controls",
		note: "A note",
	};
}
