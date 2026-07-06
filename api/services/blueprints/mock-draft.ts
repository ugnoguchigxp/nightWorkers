import type {
	MockBlueprint,
	MockBlueprintDataset,
	MockBlueprintSection,
} from "../../../shared/schemas/mock-blueprint.schema";

export function renderMockBlueprintMarkdown(
	mockBlueprint: MockBlueprint,
): string {
	const lines = [
		`# ${mockBlueprint.name}`,
		"",
		"## Mock Blueprint Summary",
		mockBlueprint.summary,
		"",
		"## Tone",
		mockBlueprint.tone,
		"",
		"## Screens",
	];
	for (const screen of mockBlueprint.screens) {
		lines.push(
			"",
			`### ${screen.name}`,
			"",
			`- Path: \`${screen.path}\``,
			`- Layout: \`${screen.layout.template}\``,
			`- Purpose: ${screen.purpose}`,
		);
		for (const section of screen.sections) {
			lines.push(
				`- Section: ${section.name} (\`${section.componentName}\`)`,
				`  - Reason: ${section.selectionReason}`,
				`  - Copy: ${section.copy.title}`,
				...datasetSummary(section).map((line) => `  - ${line}`),
			);
		}
	}
	if (mockBlueprint.generationNotes.length > 0) {
		lines.push(
			"",
			"## Generation Notes",
			...mockBlueprint.generationNotes.map((note) => `- ${note}`),
		);
	}
	return lines.join("\n");
}

export function summarizeMockBlueprintForDataModel(
	mockBlueprint: MockBlueprint,
): string {
	return mockBlueprint.screens
		.flatMap((screen) => [
			`Screen: ${screen.name} (${screen.path})`,
			`Purpose: ${screen.purpose}`,
			...screen.sections.map((section) =>
				[
					`Section: ${section.name}`,
					`component=${section.componentName}`,
					`dataset=${section.dataset.kind}`,
					`sample=${compactDatasetSample(section.dataset)}`,
				].join(" | "),
			),
		])
		.join("\n");
}

function datasetSummary(section: MockBlueprintSection): string[] {
	return [
		`Dataset: \`${section.dataset.kind}\``,
		`Sample: ${compactDatasetSample(section.dataset)}`,
	];
}

function compactDatasetSample(dataset: MockBlueprintDataset): string {
	switch (dataset.kind) {
		case "navigation":
			return dataset.items
				.slice(0, 4)
				.map((item) => item.label)
				.join(", ");
		case "table":
			return dataset.rows
				.slice(0, 2)
				.map((row) =>
					dataset.columns
						.map((column) => row[column.key])
						.filter(Boolean)
						.join(" / "),
				)
				.filter(Boolean)
				.join(" ; ");
		case "form":
			return dataset.fields
				.slice(0, 4)
				.map((field) => `${field.label}:${field.type}`)
				.join(", ");
		case "cards":
			return dataset.cards
				.slice(0, 3)
				.map((card) => card.title)
				.join(", ");
		case "kanban":
			return dataset.columns
				.slice(0, 4)
				.map((column) => `${column.title}(${column.cards.length})`)
				.join(", ");
		case "timeline":
			return dataset.items
				.slice(0, 3)
				.map((item) => item.title)
				.join(", ");
		case "article":
			return dataset.title;
		case "metrics":
			return dataset.metrics
				.slice(0, 4)
				.map((metric) => `${metric.label}:${metric.value}`)
				.join(", ");
		case "media":
			return dataset.items
				.slice(0, 3)
				.map((item) => item.title)
				.join(", ");
		case "map":
			return dataset.points
				.slice(0, 3)
				.map((point) => point.label)
				.join(", ");
		case "code":
			return dataset.files
				.slice(0, 3)
				.map((file) => file.path)
				.join(", ");
		case "chat":
			return dataset.messages
				.slice(0, 3)
				.map((message) => `${message.author}: ${message.body}`)
				.join(" / ");
		case "generic":
			return dataset.items
				.slice(0, 3)
				.map((item) => item.title)
				.join(", ");
	}
}
