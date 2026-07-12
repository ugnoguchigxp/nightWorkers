import type { RenderableMockBlueprintSectionName } from "../../../shared/schemas/mock-blueprint.schema";
import {
	arrayOfRecords,
	isRecord,
	normalizeMockBlueprintDataset,
	normalizeMockBlueprintId,
	normalizeRenderableSectionName,
	nullableString,
	stringValue,
} from "./mock-blueprint-dataset-normalizer";

export function normalizeMockBlueprintCandidate(candidate: unknown): unknown {
	if (Array.isArray(candidate)) {
		return normalizeMockBlueprintCandidate(
			candidate.find(
				(item) =>
					isRecord(item) &&
					String(item.artifactKind || "") === "mock_blueprint",
			) ?? candidate[0],
		);
	}
	if (!isRecord(candidate)) return candidate;
	const blueprint = { ...candidate };
	blueprint.id = normalizeMockBlueprintId(blueprint.id, "mock_blueprint");
	if (Array.isArray(blueprint.screens)) {
		blueprint.screens = normalizeMockBlueprintScreens(blueprint.screens);
	}
	if (!Array.isArray(blueprint.generationNotes)) blueprint.generationNotes = [];
	blueprint.meta = normalizeMockBlueprintMeta(blueprint.meta, blueprint);
	return blueprint;
}

function normalizeMockBlueprintScreens(screens: unknown[]): unknown[] {
	const normalizedScreens: Record<string, unknown>[] = [];
	for (const screen of screens) {
		if (looksLikeMockBlueprintSection(screen) && normalizedScreens.length > 0) {
			const previous = normalizedScreens[normalizedScreens.length - 1];
			const sections = Array.isArray(previous.sections)
				? previous.sections
				: [];
			previous.sections = [...sections, normalizeMockBlueprintSection(screen)];
			continue;
		}
		const normalized = normalizeMockBlueprintScreen(screen);
		if (isRecord(normalized)) normalizedScreens.push(normalized);
	}
	return normalizedScreens;
}

function normalizeMockBlueprintScreen(screen: unknown): unknown {
	if (!isRecord(screen)) return screen;
	const screenRecord = { ...screen };
	screenRecord.id = normalizeMockBlueprintId(screenRecord.id, "screen");
	if (Array.isArray(screenRecord.sections)) {
		screenRecord.sections = screenRecord.sections.map(
			normalizeMockBlueprintSection,
		);
	}
	return screenRecord;
}

function normalizeMockBlueprintSection(section: unknown): unknown {
	if (!isRecord(section)) return section;
	const sectionRecord = { ...section };
	sectionRecord.id = normalizeMockBlueprintId(sectionRecord.id, "section");
	sectionRecord.copy = normalizeMockBlueprintCopy(
		sectionRecord.copy,
		sectionRecord,
	);
	sectionRecord.dataset = normalizeMockBlueprintDataset(
		sectionRecord.dataset,
		sectionRecord,
	);
	return sectionRecord;
}

function looksLikeMockBlueprintSection(
	value: unknown,
): value is Record<string, unknown> {
	return (
		isRecord(value) &&
		typeof value.componentName === "string" &&
		isRecord(value.dataset)
	);
}

function normalizeMockBlueprintCopy(
	copy: unknown,
	section: Record<string, unknown>,
): unknown {
	const fallbackTitle = stringValue(section.name || section.id, "Mock section");
	if (!isRecord(copy)) {
		return {
			title: fallbackTitle,
			description: null,
			primaryActionLabel: null,
			secondaryActionLabel: null,
			emptyStateTitle: null,
			emptyStateDescription: null,
		};
	}
	return {
		title: stringValue(copy.title, fallbackTitle),
		description: nullableString(copy.description),
		primaryActionLabel: nullableString(copy.primaryActionLabel),
		secondaryActionLabel: nullableString(copy.secondaryActionLabel),
		emptyStateTitle: nullableString(copy.emptyStateTitle),
		emptyStateDescription: nullableString(copy.emptyStateDescription),
	};
}

function normalizeMockBlueprintMeta(
	meta: unknown,
	blueprint: Record<string, unknown>,
) {
	const sections = Array.isArray(blueprint.screens)
		? blueprint.screens.flatMap((screen) =>
				isRecord(screen) && Array.isArray(screen.sections)
					? screen.sections.filter(isRecord)
					: [],
			)
		: [];
	const metaRecord = isRecord(meta) ? meta : {};
	const explicitSections = arrayOfRecords(metaRecord.selectedSections)
		.map((section) => {
			const sectionType = normalizeRenderableSectionName(
				section.sectionType || section.componentName,
			);
			if (!sectionType) return null;
			return {
				sectionType,
				selectionReason: stringValue(
					section.selectionReason || section.reason,
					"Selected for the product mockup.",
				),
			};
		})
		.filter(
			(
				section,
			): section is {
				sectionType: RenderableMockBlueprintSectionName;
				selectionReason: string;
			} => Boolean(section),
		);
	const selectedSections = sections
		.map((section) => {
			const sectionType = normalizeRenderableSectionName(section.componentName);
			if (!sectionType) return null;
			const explicitSection = explicitSections.find(
				(item) => item.sectionType === sectionType,
			);
			return {
				sectionType,
				selectionReason: stringValue(
					explicitSection?.selectionReason || section.selectionReason,
					"Selected for the product mockup.",
				),
			};
		})
		.filter(
			(
				section,
			): section is {
				sectionType: RenderableMockBlueprintSectionName;
				selectionReason: string;
			} => Boolean(section),
		);
	return {
		intent: stringValue(
			metaRecord.intent || blueprint.summary || blueprint.name,
			"Mock blueprint preview",
		),
		selectedSections:
			selectedSections.length > 0
				? selectedSections
				: [
						{
							sectionType: "CardGridSection" as const,
							selectionReason: "Selected for the product mockup.",
						},
					],
	};
}
