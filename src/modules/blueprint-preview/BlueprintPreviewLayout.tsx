import { BlueprintPreviewSection } from "./BlueprintPreviewSection";
import {
	canUseBlueprintSideColumn,
	coerceBlueprintSideRegion,
} from "./sidebarPlacement";

type BlueprintScreenLayoutTemplate =
	| "single_column"
	| "two_column"
	| "three_column"
	| "sidebar_left"
	| "sidebar_right"
	| "article_with_sidebar";

type BlueprintSectionRegion =
	| "header"
	| "main"
	| "sidebar"
	| "aside"
	| "full_width"
	| "footer";

type ArrangedBlueprintSections = Record<
	BlueprintSectionRegion,
	Array<Record<string, unknown>>
>;

export function BlueprintScreenSectionLayout({
	layout,
	sections,
}: {
	layout: BlueprintScreenLayoutTemplate;
	sections: ArrangedBlueprintSections;
}) {
	const hasColumns = sections.sidebar.length > 0 || sections.aside.length > 0;

	return (
		<div className="grid gap-[var(--blueprint-preview-gap)]">
			<BlueprintRegionSections sections={sections.header} />
			<BlueprintRegionSections sections={sections.full_width} />
			{hasColumns ? (
				<div className={screenGridClassName(layout, sections)}>
					{sections.sidebar.length > 0 ? (
						<aside className="grid content-start gap-[var(--blueprint-preview-gap)]">
							<BlueprintRegionSections sections={sections.sidebar} />
						</aside>
					) : null}
					<main className="grid min-w-0 content-start gap-[var(--blueprint-preview-gap)]">
						<BlueprintRegionSections sections={sections.main} />
					</main>
					{sections.aside.length > 0 ? (
						<aside className="grid content-start gap-[var(--blueprint-preview-gap)]">
							<BlueprintRegionSections sections={sections.aside} />
						</aside>
					) : null}
				</div>
			) : (
				<BlueprintRegionSections sections={sections.main} />
			)}
			<BlueprintRegionSections sections={sections.footer} />
		</div>
	);
}

function BlueprintRegionSections({
	sections,
}: {
	sections: Array<Record<string, unknown>>;
}) {
	if (sections.length === 0) return null;
	return (
		<>
			{sections.map((section, _index) => (
				<BlueprintPreviewSection
					key={String(section.id || `-`)}
					section={section}
				/>
			))}
		</>
	);
}

export function resolveScreenLayout(
	screen: Record<string, unknown>,
): BlueprintScreenLayoutTemplate {
	const layout = screen.layout;
	if (!layout || typeof layout !== "object" || Array.isArray(layout))
		return "single_column";
	const template = String(
		(layout as Record<string, unknown>).template || "single_column",
	);
	if (
		template === "two_column" ||
		template === "three_column" ||
		template === "sidebar_left" ||
		template === "sidebar_right" ||
		template === "article_with_sidebar"
	) {
		return template;
	}
	return "single_column";
}

export function arrangeSectionsByRegion(
	sections: Array<Record<string, unknown>>,
): ArrangedBlueprintSections {
	const arranged: ArrangedBlueprintSections = {
		header: [],
		main: [],
		sidebar: [],
		aside: [],
		full_width: [],
		footer: [],
	};
	for (const section of sections) {
		arranged[sectionRegion(section)].push(section);
	}
	return arranged;
}

export function displayedSections(sections: ArrangedBlueprintSections) {
	return [
		...sections.header,
		...sections.full_width,
		...sections.sidebar,
		...sections.main,
		...sections.aside,
		...sections.footer,
	];
}

function sectionRegion(
	section: Record<string, unknown>,
): BlueprintSectionRegion {
	const explicitRegion = String(section.region || "");
	if (isBlueprintSectionRegion(explicitRegion)) {
		return coerceBlueprintSideRegion(explicitRegion, section);
	}
	const componentName = String(section.componentName || "");
	if (
		componentName === "TopMenuSection" ||
		componentName === "TabNavigationSection"
	) {
		return "header";
	}
	if (componentName === "FooterNavigationSection") return "footer";
	if (componentName === "RightSidebarLinksSection") return "aside";
	if (canUseBlueprintSideColumn(section)) {
		return "sidebar";
	}
	if (componentName === "FullBleedHeroSection") return "full_width";
	return "main";
}

function isBlueprintSectionRegion(
	value: string,
): value is BlueprintSectionRegion {
	return (
		value === "header" ||
		value === "main" ||
		value === "sidebar" ||
		value === "aside" ||
		value === "full_width" ||
		value === "footer"
	);
}

function screenGridClassName(
	layout: BlueprintScreenLayoutTemplate,
	sections: ArrangedBlueprintSections,
) {
	if (layout === "three_column") {
		return "grid gap-[var(--blueprint-preview-gap)] lg:grid-cols-[15rem_minmax(0,1fr)_15rem]";
	}
	if (layout === "sidebar_left" || sections.sidebar.length > 0) {
		return "grid gap-[var(--blueprint-preview-gap)] lg:grid-cols-[16rem_minmax(0,1fr)]";
	}
	if (layout === "article_with_sidebar") {
		return "grid gap-[var(--blueprint-preview-gap)] lg:grid-cols-[minmax(0,1fr)_18rem]";
	}
	return "grid gap-[var(--blueprint-preview-gap)] lg:grid-cols-[minmax(0,1fr)_18rem]";
}
