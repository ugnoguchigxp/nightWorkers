import type {
	MockBlueprint,
	MockBlueprintDatasetKind,
	RenderableMockBlueprintSectionName,
} from "../../../shared/schemas/mock-blueprint.schema";
import {
	getMockBlueprintDatasetKindsForSection,
	mockBlueprintDatasetKinds,
	mockBlueprintSchema,
	renderableMockBlueprintSectionNames,
} from "../../../shared/schemas/mock-blueprint.schema";
import {
	buildMockBlueprintSectionCatalog,
	buildMockBlueprintStructuredOutputJsonSchema,
	buildMockBlueprintSystemPrompt,
	buildMockBlueprintUserPrompt,
	MOCK_BLUEPRINT_PROMPT_VERSION,
	mockBlueprintPromptDiagnostics,
} from "../structured-generation/prompts/mock-blueprint";
import {
	callStructuredJsonLLM,
	type SupervisorLlmDebugEvent,
} from "../structured-llm";
import {
	type JsonFixWrapperResult,
	jsonFixWrapper,
} from "../structured-llm/json";
import type { StructuredLlmModelTarget } from "../structured-llm/settings";

export type GeneratedMockBlueprintDraft = {
	mockBlueprint: MockBlueprint;
	generation: {
		source: "llm";
		promptVersion: typeof MOCK_BLUEPRINT_PROMPT_VERSION;
		rawOutput?: string;
		jsonRepair?: {
			repaired: boolean;
			repairKind: JsonFixWrapperResult["repairKind"];
		};
		promptDiagnostics: MockBlueprintPromptDiagnostics;
	};
};

export type MockBlueprintPromptDiagnostics = ReturnType<
	typeof mockBlueprintPromptDiagnostics
>;

export class MockBlueprintDraftGenerationError extends Error {
	rawOutput?: string;
	promptDiagnostics: MockBlueprintPromptDiagnostics;

	constructor(
		message: string,
		input: {
			rawOutput?: string;
			promptDiagnostics: MockBlueprintPromptDiagnostics;
		},
	) {
		super(message);
		this.name = "MockBlueprintDraftGenerationError";
		this.rawOutput = input.rawOutput;
		this.promptDiagnostics = input.promptDiagnostics;
	}
}

export async function generatePlanModeMockBlueprintDraft(input: {
	taskId: string;
	title: string;
	prompt: string;
	description?: string | null;
	objective?: string | null;
	questionnaireMarkdown?: string | null;
	projectStackContext?: string | null;
	specContext?: string | null;
	emitEvent?: (event: SupervisorLlmDebugEvent) => Promise<void> | void;
	routeOverride?: StructuredLlmModelTarget | null;
}): Promise<GeneratedMockBlueprintDraft> {
	const schema = buildMockBlueprintStructuredOutputJsonSchema();
	const systemPrompt = buildMockBlueprintSystemPrompt({
		sectionCatalog: buildMockBlueprintSectionCatalog(),
		jsonSchema: schema,
	});
	const userPrompt = buildMockBlueprintUserPrompt({
		task: {
			id: input.taskId,
			title: input.title,
			description: input.description,
			objective: input.objective,
		},
		questionnaireMarkdown: input.questionnaireMarkdown,
		projectStackContext: input.projectStackContext,
		specContext: input.specContext,
		prompt: input.prompt,
	});
	const promptDiagnostics = mockBlueprintPromptDiagnostics({
		systemPrompt,
		userPrompt,
		schema,
	});
	const rawOutput = await callStructuredJsonLLM(systemPrompt, userPrompt, {
		schemaName: "mock_blueprint",
		schema,
		emitEvent: input.emitEvent,
		taskId: input.taskId,
		runId: null,
		role: "plan",
		routeOverride: input.routeOverride || null,
		allowRawOutputOnJsonParseFailure: true,
	});

	const parsed = parseMockBlueprintJsonOutput(rawOutput);
	if (!parsed.ok) {
		throw new MockBlueprintDraftGenerationError(
			parsed.reason === "schema"
				? `Mock Blueprint LLM output failed schema validation: ${parsed.message}`
				: "Mock Blueprint LLM output did not contain valid JSON.",
			{ rawOutput, promptDiagnostics },
		);
	}

	return {
		mockBlueprint: parsed.value,
		generation: {
			source: "llm",
			promptVersion: MOCK_BLUEPRINT_PROMPT_VERSION,
			rawOutput,
			jsonRepair: {
				repaired: parsed.repaired,
				repairKind: parsed.repairKind,
			},
			promptDiagnostics,
		},
	};
}

function parseMockBlueprintJsonOutput(rawOutput: string):
	| {
			ok: true;
			value: MockBlueprint;
			sourceText: string;
			repaired: boolean;
			repairKind: JsonFixWrapperResult["repairKind"];
	  }
	| {
			ok: false;
			reason: "parse" | "schema";
			message: string;
			rawOutput: string;
	  } {
	const jsonFix = jsonFixWrapper(rawOutput);
	if (jsonFix) {
		const rawParsed = mockBlueprintSchema.safeParse(jsonFix.parsedJson);
		const normalized = normalizeMockBlueprintCandidate(jsonFix.parsedJson);
		const normalizedParsed = mockBlueprintSchema.safeParse(normalized);
		if (normalizedParsed.success) {
			return {
				ok: true,
				value: normalizedParsed.data,
				sourceText: jsonFix.sourceText,
				repaired: jsonFix.repaired || !rawParsed.success,
				repairKind: jsonFix.repairKind,
			};
		}

		return {
			ok: false,
			reason: "schema",
			message: normalizedParsed.error.issues
				.slice(0, 6)
				.map((issue) => `${issue.path.join(".") || "$"}:${issue.message}`)
				.join(", "),
			rawOutput,
		};
	}

	const balancedPrefix = firstBalancedJsonObject(rawOutput);
	if (!balancedPrefix) {
		return {
			ok: false,
			reason: "parse",
			message: "LLM output did not contain repairable JSON.",
			rawOutput,
		};
	}
	const prefixParsed = parseNormalizedMockBlueprintCandidate(balancedPrefix);
	if (prefixParsed.ok) {
		return {
			ok: true,
			value: prefixParsed.value,
			sourceText: balancedPrefix,
			repaired: true,
			repairKind: "balanced_json",
		};
	}
	return prefixParsed.error;
}

function parseNormalizedMockBlueprintCandidate(sourceText: string):
	| { ok: true; value: MockBlueprint }
	| {
			ok: false;
			error: {
				ok: false;
				reason: "parse" | "schema";
				message: string;
				rawOutput: string;
			};
	  } {
	try {
		const normalized = normalizeMockBlueprintCandidate(JSON.parse(sourceText));
		const parsed = mockBlueprintSchema.safeParse(normalized);
		if (parsed.success) return { ok: true, value: parsed.data };
		return {
			ok: false,
			error: {
				ok: false,
				reason: "schema",
				message: parsed.error.issues
					.slice(0, 6)
					.map((issue) => `${issue.path.join(".") || "$"}:${issue.message}`)
					.join(", "),
				rawOutput: sourceText,
			},
		};
	} catch (error) {
		return {
			ok: false,
			error: {
				ok: false,
				reason: "parse",
				message: error instanceof Error ? error.message : String(error),
				rawOutput: sourceText,
			},
		};
	}
}

function normalizeMockBlueprintCandidate(candidate: unknown): unknown {
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

function normalizeMockBlueprintDataset(
	dataset: unknown,
	section: Record<string, unknown> = {},
): unknown {
	if (!isRecord(dataset)) return fallbackDatasetForSection(section);
	const datasetKind = normalizeDatasetKind(dataset.kind, section);
	const sample = sampleContext(section);
	switch (datasetKind) {
		case "navigation":
			return {
				kind: "navigation",
				items: ensureMinRecords(arrayOfRecords(dataset.items), 2, (index) => ({
					label: `${sample.title} ${index + 1}`,
					href: `/${stableMockKey(sample.title).toLowerCase()}-${index + 1}`,
					active: index === 0,
				})).map((item) => ({
					label: stringValue(item.label || item.title || item.name, "Item"),
					...(typeof item.href === "string" ? { href: item.href } : {}),
					...(typeof item.active === "boolean" ? { active: item.active } : {}),
				})),
			};
		case "table": {
			const columns = ensureMinRecords(
				arrayOfRecords(dataset.columns),
				2,
				(index) => ({
					key: `column_${index + 1}`,
					label: index === 0 ? sample.title : "Status",
				}),
			).map((column, index) => ({
				key: stableMockKey(column.key || column.name || `column_${index + 1}`),
				label: stringValue(
					column.label || column.name || column.key,
					`Column ${index + 1}`,
				),
			}));
			return {
				kind: "table",
				columns,
				rows: ensureMinRecords(
					Array.isArray(dataset.rows) ? dataset.rows.filter(isRecord) : [],
					5,
					(index) => fallbackTableRow(columns, sample, index),
				).map((row, index) => {
					const normalized = normalizeTableRow(row);
					return Object.keys(normalized).length > 0
						? normalized
						: fallbackTableRow(columns, sample, index);
				}),
			};
		}
		case "form":
			return {
				kind: "form",
				fields: ensureMinRecords(
					arrayOfRecords(dataset.fields),
					2,
					(index) => ({
						name: index === 0 ? "title" : "details",
						label: index === 0 ? sample.title : "Details",
						type: index === 0 ? "text" : "textarea",
						placeholder: index === 0 ? sample.title : sample.description,
					}),
				).map((field, index) => ({
					name: stableMockKey(field.name || field.key || `field_${index + 1}`),
					label: stringValue(
						field.label || field.name || field.key,
						`Field ${index + 1}`,
					),
					type: normalizeFieldType(field.type),
					...(typeof field.placeholder === "string" && field.placeholder.trim()
						? { placeholder: field.placeholder.trim() }
						: {}),
					...(Array.isArray(field.options)
						? { options: field.options.map(String) }
						: {}),
				})),
				submitLabel: stringValue(
					dataset.submitLabel || dataset.primaryActionLabel,
					"Submit",
				),
			};
		case "cards":
			return {
				kind: "cards",
				cards: ensureMinRecords(
					arrayOfRecords(dataset.cards || dataset.items),
					2,
					(index) => ({
						title: `${sample.title} ${index + 1}`,
						description: sample.description,
						meta: index === 0 ? "Primary" : "Secondary",
					}),
				).map((card) => ({
					title: stringValue(card.title || card.label || card.name, "Card"),
					description: stringValue(
						card.description || card.summary || card.body || card.content,
						"No description.",
					),
					...(typeof card.meta === "string" ? { meta: card.meta } : {}),
					...(typeof card.actionLabel === "string"
						? { actionLabel: card.actionLabel }
						: {}),
				})),
			};
		case "kanban":
			return {
				kind: "kanban",
				columns: ensureMinRecords(
					arrayOfRecords(dataset.columns),
					1,
					(index) => ({
						id: `column_${index + 1}`,
						title: index === 0 ? "Active" : `Column ${index + 1}`,
						cards: [
							{ title: `${sample.title} 1`, description: sample.description },
							{ title: `${sample.title} 2`, description: sample.description },
						],
					}),
				).map((column, index) => ({
					id: stableMockKey(column.id || column.key || `column_${index + 1}`),
					title: stringValue(
						column.title || column.label || column.name,
						`Column ${index + 1}`,
					),
					cards: arrayOfRecords(column.cards || column.items).map((card) => ({
						title: stringValue(card.title || card.label || card.name, "Card"),
						description: stringValue(
							card.description || card.summary || card.body,
							"No details.",
						),
						...(typeof card.meta === "string" ? { meta: card.meta } : {}),
					})),
				})),
			};
		case "timeline":
			return {
				kind: "timeline",
				items: ensureMinRecords(arrayOfRecords(dataset.items), 2, (index) => ({
					title: `${sample.title} ${index + 1}`,
					description: sample.description,
				})).map((item) => ({
					title: stringValue(item.title || item.label || item.name, "Event"),
					description: stringValue(
						item.description || item.summary || item.body || item.content,
						"No details.",
					),
					...(typeof item.timestamp === "string"
						? { timestamp: item.timestamp }
						: {}),
				})),
			};
		case "article":
			return {
				kind: "article",
				title: stringValue(dataset.title || dataset.label, sample.title),
				body: ensureArticleBodyLength(
					stringValue(
						dataset.body || dataset.content || dataset.description,
						sample.description,
					),
					sample,
				),
				...(articleMeta(dataset).length > 0
					? { meta: articleMeta(dataset) }
					: {}),
			};
		case "metrics":
			return {
				kind: "metrics",
				metrics: ensureMinRecords(
					arrayOfRecords(dataset.metrics || dataset.items),
					2,
					(index) => ({
						label: index === 0 ? sample.title : "Secondary signal",
						value: index === 0 ? "5" : "2",
						trend: index === 0 ? "review ready" : "watching",
					}),
				).map((metric) => ({
					label: stringValue(
						metric.label || metric.title || metric.name,
						"Metric",
					),
					value: scalarValue(metric.value ?? metric.count ?? metric.total, "0"),
					...(typeof metric.trend === "string" ? { trend: metric.trend } : {}),
				})),
			};
		case "media":
			return {
				kind: "media",
				items: ensureMinRecords(
					arrayOfRecords(dataset.items || dataset.cards),
					1,
					(index) => ({
						title: `${sample.title} ${index + 1}`,
						description: sample.description,
					}),
				).map((item) => ({
					title: stringValue(item.title || item.label || item.name, "Media"),
					description: stringValue(
						item.description || item.summary || item.caption,
						"No details.",
					),
					...(typeof item.mediaLabel === "string"
						? { mediaLabel: item.mediaLabel }
						: {}),
				})),
			};
		case "map":
			return {
				kind: "map",
				points: ensureMinRecords(
					arrayOfRecords(dataset.points || dataset.items),
					1,
					(index) => ({
						label: `${sample.title} ${index + 1}`,
						description: sample.description,
					}),
				).map((point) => ({
					label: stringValue(point.label || point.title || point.name, "Point"),
					description: stringValue(
						point.description || point.summary || point.body,
						"No details.",
					),
					...(typeof point.region === "string" ? { region: point.region } : {}),
				})),
			};
		case "code":
			return {
				kind: "code",
				files: ensureMinRecords(
					arrayOfRecords(dataset.files || dataset.items),
					1,
					(index) => ({
						path: `mock-${index + 1}.txt`,
						language: "text",
						excerpt: sample.description,
					}),
				).map((file) => ({
					path: stringValue(file.path || file.title || file.name, "file.txt"),
					language: stringValue(file.language || file.lang, "text"),
					excerpt: stringValue(
						file.excerpt || file.body || file.content,
						"No excerpt.",
					),
				})),
			};
		case "chat":
			return {
				kind: "chat",
				messages: ensureMinRecords(
					arrayOfRecords(dataset.messages || dataset.items),
					2,
					(index) => ({
						author: index === 0 ? "User" : "Team",
						body: sample.description,
						state: index === 0 ? "active" : "reply",
					}),
				).map((message) => ({
					author: stringValue(
						message.author || message.name || message.role,
						"User",
					),
					body: stringValue(
						message.body || message.content || message.description,
						"No message.",
					),
					...(typeof message.state === "string"
						? { state: message.state }
						: {}),
				})),
			};
		case "generic":
			return {
				kind: "generic",
				items: ensureMinRecords(
					arrayOfRecords(dataset.items || dataset.cards),
					2,
					(index) => ({
						title: `${sample.title} ${index + 1}`,
						description: sample.description,
					}),
				).map((item) => ({
					title: stringValue(item.title || item.label || item.name, "Item"),
					description: stringValue(
						item.description || item.summary || item.body,
						"No details.",
					),
				})),
			};
		default:
			return fallbackDatasetForSection(section);
	}
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

function normalizeDatasetKind(
	value: unknown,
	section: Record<string, unknown>,
): MockBlueprintDatasetKind {
	const candidate = mockBlueprintDatasetKinds.includes(
		value as MockBlueprintDatasetKind,
	)
		? (value as MockBlueprintDatasetKind)
		: null;
	const sectionName = normalizeRenderableSectionName(section.componentName);
	if (!sectionName) return candidate || "generic";
	const allowedKinds = getMockBlueprintDatasetKindsForSection(sectionName);
	if (candidate && allowedKinds.includes(candidate)) return candidate;
	return allowedKinds[0] || "generic";
}

function fallbackDatasetForSection(section: Record<string, unknown>) {
	return normalizeMockBlueprintDataset(
		{ kind: normalizeDatasetKind(null, section) },
		section,
	);
}

function normalizeRenderableSectionName(
	value: unknown,
): RenderableMockBlueprintSectionName | null {
	return renderableMockBlueprintSectionNames.includes(
		value as RenderableMockBlueprintSectionName,
	)
		? (value as RenderableMockBlueprintSectionName)
		: null;
}

function sampleContext(section: Record<string, unknown>) {
	const copy = isRecord(section.copy) ? section.copy : {};
	return {
		title: stringValue(copy.title || section.name || section.id, "Mock item"),
		description: stringValue(
			copy.description || section.selectionReason,
			"Representative mock content for this product screen.",
		),
	};
}

function ensureMinRecords(
	records: Array<Record<string, unknown>>,
	min: number,
	build: (index: number) => Record<string, unknown>,
) {
	const next = [...records];
	while (next.length < min) next.push(build(next.length));
	return next;
}

function fallbackTableRow(
	columns: Array<{ key: string; label: string }>,
	sample: { title: string; description: string },
	index: number,
) {
	return Object.fromEntries(
		columns.map((column, columnIndex) => [
			column.key,
			columnIndex === 0 ? `${sample.title} ${index + 1}` : sample.description,
		]),
	);
}

function ensureArticleBodyLength(
	body: string,
	sample: { title: string; description: string },
) {
	if (body.trim().length >= 180) return body;
	return [
		body,
		`${sample.title} では、ユーザーが内容を読みながら状況を判断できるように、背景、現在の状態、次に取れる行動を同じ画面で確認できます。`,
		`この mock data は実装メモではなく、実際の利用画面に表示される本文として、投稿内容、補足説明、確認したいポイントを含めています。`,
		"読み手が一覧から詳細へ移動したあとに、本文だけで判断を続けられるよう、具体的な説明文を十分に持たせます。",
	]
		.filter(Boolean)
		.join("\n\n");
}

function normalizeTableRow(row: unknown) {
	if (!isRecord(row)) return {};
	return Object.fromEntries(
		Object.entries(row).map(([key, value]) => [key, scalarValue(value, "")]),
	);
}

function articleMeta(dataset: Record<string, unknown>) {
	const meta = arrayOfRecords(dataset.meta).map((item) => ({
		label: stringValue(item.label || item.title || item.name, "Meta"),
		value: stringValue(item.value || item.description || item.body, ""),
	}));
	if (typeof dataset.author === "string")
		meta.push({ label: "author", value: dataset.author });
	if (typeof dataset.publishedAt === "string") {
		meta.push({ label: "publishedAt", value: dataset.publishedAt });
	}
	return meta.filter((item) => item.value);
}

function normalizeFieldType(value: unknown) {
	return ["text", "textarea", "select", "checkbox", "date", "number"].includes(
		String(value),
	)
		? String(value)
		: "text";
}

function stableMockKey(value: unknown) {
	const key = String(value || "item")
		.trim()
		.replace(/[^A-Za-z0-9_-]+/g, "_")
		.replace(/^_+|_+$/g, "");
	return /^[A-Za-z][A-Za-z0-9_-]*$/.test(key) ? key : `item_${key || "1"}`;
}

function normalizeMockBlueprintId(value: unknown, fallback: string) {
	return stableMockKey(value || fallback);
}

function scalarValue(value: unknown, fallback: string) {
	if (
		typeof value === "string" ||
		typeof value === "number" ||
		typeof value === "boolean"
	) {
		return value;
	}
	return fallback;
}

function stringValue(value: unknown, fallback: string) {
	return typeof value === "string" && value.trim() ? value : fallback;
}

function nullableString(value: unknown) {
	return typeof value === "string" && value.trim() ? value : null;
}

function arrayOfRecords(value: unknown): Array<Record<string, unknown>> {
	return Array.isArray(value) ? value.filter(isRecord) : [];
}

function firstBalancedJsonObject(input: string): string | null {
	const trimmed = input.trim();
	if (!trimmed.startsWith("{")) return null;

	let depth = 0;
	let inString = false;
	let escaped = false;
	for (let index = 0; index < trimmed.length; index += 1) {
		const char = trimmed[index];
		if (escaped) {
			escaped = false;
			continue;
		}
		if (char === "\\" && inString) {
			escaped = true;
			continue;
		}
		if (char === '"') {
			inString = !inString;
			continue;
		}
		if (inString) continue;
		if (char === "{") depth += 1;
		if (char === "}") depth -= 1;
		if (depth === 0) return trimmed.slice(0, index + 1);
	}
	return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
