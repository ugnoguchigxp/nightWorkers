type BlueprintSectionLike = {
	id?: unknown;
	name?: unknown;
	componentName?: unknown;
};

type SideRegion = "sidebar" | "aside";

const sidebarComponentNames = new Set([
	"SidebarMenuSection",
	"LeftSidebarSection",
	"ExplorerSidebarSection",
	"RightSidebarLinksSection",
]);

export function canUseBlueprintSideColumn(
	section: BlueprintSectionLike,
): boolean {
	const componentName = String(section.componentName || "");
	if (sidebarComponentNames.has(componentName)) return true;

	return [componentName, section.name, section.id].some((value) =>
		hasSidebarName(value),
	);
}

export function coerceBlueprintSideRegion<T extends string>(
	region: T,
	section: BlueprintSectionLike,
): T | "main" {
	if (isSideRegion(region) && !canUseBlueprintSideColumn(section))
		return "main";
	return region;
}

function isSideRegion(region: string): region is SideRegion {
	return region === "sidebar" || region === "aside";
}

function hasSidebarName(value: unknown): boolean {
	const normalized = String(value || "")
		.toLowerCase()
		.replace(/[\s_-]+/g, "");
	return (
		normalized.includes("sidebar") ||
		normalized.includes("sidemenu") ||
		normalized.includes("サイドバー") ||
		normalized.includes("サイドメニュー")
	);
}
