import { useTranslation } from "react-i18next";
import { createPresetBlueprintNodeTree } from "../../../shared/blueprint-composition-catalog";
import {
	applyBlueprintSectionOverridesToNode,
	normalizeBlueprintSectionForPreview,
} from "../../../shared/blueprint-section-composition";
import type {
	BlueprintNode,
	BlueprintSection,
	BlueprintSectionOverride,
} from "../../../shared/schemas/app-blueprint-ui.schema";
import {
	PreviewBadge,
	PreviewButton,
	PreviewCard,
	PreviewField,
	PreviewProgress,
	PreviewTable,
} from "./BlueprintPreviewPrimitives";
import { renderAdditionalPreviewSectionBody } from "./BlueprintPreviewSectionMore";
import {
	isObject,
	previewColumns,
	previewRows,
	sectionFallbackText,
	toObjectArray,
} from "./previewModel";

export function BlueprintPreviewSection({
	section,
}: {
	section: Record<string, unknown>;
}) {
	const { t } = useTranslation();
	const previewSection = normalizeBlueprintSectionForPreview(
		section as BlueprintSection,
	) as Record<string, unknown>;
	const isComposableSection =
		previewSection.kind === "preset_section" ||
		previewSection.kind === "custom_section";
	const componentName = isComposableSection
		? String(previewSection.preset || previewSection.kind || "")
		: String(previewSection.componentName || "");
	const props = isObject(previewSection.props) ? previewSection.props : {};
	const body = isComposableSection
		? renderComposableSection(previewSection, t)
		: renderPreviewSectionBody(componentName, props, t);

	return (
		<section className="min-w-0" data-preview-shell="transparent">
			{body}
		</section>
	);
}

function renderComposableSection(
	section: Record<string, unknown>,
	t: ReturnType<typeof useTranslation>["t"],
) {
	const root =
		section.kind === "custom_section" && isObject(section.root)
			? section.root
			: expandPresetSection(section, t);
	const resolvedRoot = applyBlueprintSectionOverridesToNode(
		root as BlueprintNode,
		Array.isArray(section.overrides)
			? (section.overrides as BlueprintSectionOverride[])
			: [],
	);
	return resolvedRoot
		? renderBlueprintNode(resolvedRoot as Record<string, unknown>, t)
		: null;
}

function expandPresetSection(
	section: Record<string, unknown>,
	t: ReturnType<typeof useTranslation>["t"],
): Record<string, unknown> {
	return createPresetBlueprintNodeTree({
		preset: String(section.preset || ""),
		sectionId: String(section.id || ""),
		sectionName: typeof section.name === "string" ? section.name : undefined,
		props: isObject(section.props) ? section.props : {},
		labels: {
			searchPlaceholder: t("blueprint.preview.searchPlaceholder"),
			primarySignal: t("blueprint.preview.kpi.primarySignal"),
			secondarySignal: t("blueprint.preview.kpi.secondarySignal"),
			nextAction: t("blueprint.preview.kpi.nextAction"),
		},
	}) as Record<string, unknown>;
}

function renderBlueprintNode(
	node: Record<string, unknown>,
	t: ReturnType<typeof useTranslation>["t"],
) {
	if (node.kind === "layout") return renderLayoutNode(node, t);
	if (node.kind === "component") return renderComponentNode(node, t);
	return null;
}

function renderLayoutNode(
	node: Record<string, unknown>,
	t: ReturnType<typeof useTranslation>["t"],
) {
	const layout = String(node.layout || "stack");
	const props = isObject(node.props) ? node.props : {};
	const children = toObjectArray(node.children);
	const className =
		layout === "row"
			? "flex flex-wrap items-center gap-[var(--blueprint-preview-gap)]"
			: layout === "grid"
				? "grid gap-[var(--blueprint-preview-gap)]"
				: layout === "split"
					? "grid gap-[var(--blueprint-preview-gap)] md:grid-cols-2"
					: "grid gap-[var(--blueprint-preview-gap)]";
	const style =
		layout === "grid" && Number(props.columns) > 0
			? {
					gridTemplateColumns: `repeat(${Math.min(Number(props.columns), 4)}, minmax(0, 1fr))`,
				}
			: undefined;
	return (
		<div className={className} style={style}>
			{children.map((child, _index) => (
				<div
					className={layoutWidthClass(child.layout)}
					key={String(child.id || child.componentName || JSON.stringify(child))}
				>
					{renderBlueprintNode(child, t)}
				</div>
			))}
		</div>
	);
}

function renderComponentNode(
	node: Record<string, unknown>,
	t: ReturnType<typeof useTranslation>["t"],
) {
	const component = String(node.component || "");
	const props = isObject(node.props) ? node.props : {};
	const label = String(props.label || props.title || props.name || component);
	const description = String(
		props.description || props.body || props.content || "",
	);

	if (component === "Text") {
		return (
			<div className="min-w-0">
				<div className="font-semibold text-foreground">{label}</div>
				{description ? (
					<p className="mt-1 text-xs leading-5 text-muted-foreground">
						{description}
					</p>
				) : null}
			</div>
		);
	}

	if (component === "Button" || component === "IconButton") {
		return <PreviewButton>{label}</PreviewButton>;
	}

	if (
		component === "Input" ||
		component === "InputGroup" ||
		component === "Select"
	) {
		return <PreviewField>{String(props.placeholder || label)}</PreviewField>;
	}

	if (component === "DataTable" || component === "Table") {
		const columns = previewColumns(props);
		const rows = previewRows(props, columns);
		return <PreviewTable columns={columns} rows={rows} />;
	}

	if (component === "KanbanTable") {
		const columns = buildComposableKanbanColumns(props);
		const rowCount = Math.min(
			Math.max(...columns.map((column) => column.cards.length), 0),
			5,
		);
		return (
			<div className="overflow-x-auto border border-border bg-card">
				<table className="min-w-[44rem] w-full table-fixed border-collapse text-left text-xs">
					<thead>
						<tr className="border-border border-b bg-muted">
							<th className="w-14 border-border border-r px-3 py-2 font-medium text-muted-foreground">
								#
							</th>
							{columns.map((column) => (
								<th
									className="border-border border-r px-3 py-2 font-semibold text-foreground last:border-r-0"
									key={column.key}
								>
									<div className="flex items-center justify-between gap-2">
										<span className="truncate">{column.label}</span>
										<span className="text-[10px] font-medium text-muted-foreground">
											{column.cards.length}
										</span>
									</div>
								</th>
							))}
						</tr>
					</thead>
					<tbody>
						{Array.from({ length: rowCount }).map((_, rowIndex) => (
							<tr
								className="border-border border-b last:border-b-0"
								key={columns
									.map((column) =>
										String(
											column.cards[rowIndex]?.title ||
												column.cards[rowIndex]?.label ||
												"",
										),
									)
									.join("|")}
							>
								<td className="border-border border-r bg-muted/50 px-3 py-3 align-top font-medium text-muted-foreground">
									{rowIndex + 1}
								</td>
								{columns.map((column) => {
									const task = column.cards[rowIndex];
									return (
										<td
											className="h-20 border-border border-r bg-background px-3 py-3 align-top last:border-r-0"
											key={column.key}
										>
											{task ? (
												<div
													className="grid cursor-grab gap-2 rounded-md border border-border bg-card px-3 py-2 shadow-sm active:cursor-grabbing"
													draggable
												>
													<div className="flex items-start justify-between gap-2">
														<span className="min-w-0 font-medium text-foreground">
															{String(
																task.title || task.label || task.name || "Task",
															)}
														</span>
														{task.priority || task.badge || task.tag ? (
															<span className="shrink-0 text-[10px] font-medium text-muted-foreground">
																{String(
																	task.priority || task.badge || task.tag,
																)}
															</span>
														) : null}
													</div>
													<div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
														<span>
															{String(
																task.assignee || task.owner || "Unassigned",
															)}
														</span>
														{task.dueDate || task.updatedAt ? (
															<span>
																{String(task.dueDate || task.updatedAt)}
															</span>
														) : null}
													</div>
												</div>
											) : (
												<span className="text-muted-foreground/50">-</span>
											)}
										</td>
									);
								})}
							</tr>
						))}
					</tbody>
				</table>
			</div>
		);
	}

	if (component === "List") {
		const items = toObjectArray(props.items);
		return (
			<PreviewCard className="bg-card p-3">
				<div className="font-semibold text-foreground">{label}</div>
				<div className="mt-2 grid gap-2">
					{(items.length > 0
						? items
						: [{ title: t("blueprint.preview.sectionFallbackTitle") }]
					)
						.slice(0, 5)
						.map((item, index) => (
							<div
								className="rounded border border-border bg-muted px-2 py-1.5 text-xs"
								key={String(
									item.id || item.title || item.label || JSON.stringify(item),
								)}
							>
								<div className="font-medium text-foreground">
									{String(item.title || item.label || `Item ${index + 1}`)}
								</div>
								{item.description ? (
									<div className="mt-1 text-muted-foreground">
										{String(item.description)}
									</div>
								) : null}
							</div>
						))}
				</div>
			</PreviewCard>
		);
	}

	if (component === "Badge") {
		return (
			<PreviewBadge className="rounded-full text-foreground">
				{label}
			</PreviewBadge>
		);
	}

	if (component === "Alert") {
		return (
			<div className="rounded-md border border-border bg-muted p-3 text-xs">
				<div className="font-semibold text-foreground">{label}</div>
				{description ? (
					<div className="mt-1 leading-5 text-muted-foreground">
						{description}
					</div>
				) : null}
			</div>
		);
	}

	if (component === "Progress") {
		const value = Math.max(0, Math.min(100, Number(props.value) || 0));
		return <PreviewProgress label={label} value={value} />;
	}

	return (
		<PreviewCard className="bg-card p-3">
			<div className="font-semibold text-foreground">{label}</div>
			{description ? (
				<div className="mt-1 text-xs leading-5 text-muted-foreground">
					{description}
				</div>
			) : null}
		</PreviewCard>
	);
}

function buildComposableKanbanColumns(props: Record<string, unknown>) {
	const columns = toObjectArray(props.columns).slice(0, 5);
	if (columns.length === 0) {
		return [
			{
				key: "draft",
				label: "Draft",
				cards: [{ title: "Define section props" }],
			},
			{
				key: "preview",
				label: "Preview",
				cards: [{ title: "Check responsive layout" }],
			},
			{ key: "ready", label: "Ready", cards: [{ title: "Publish Blueprint" }] },
		];
	}

	return columns.map((column, index) => ({
		key: String(
			column.id || column.key || column.title || `column-${index + 1}`,
		),
		label: String(
			column.title || column.label || column.name || `Column ${index + 1}`,
		),
		cards: toObjectArray(column.cards || column.items || column.tasks),
	}));
}

function layoutWidthClass(layout: unknown) {
	if (!isObject(layout)) return "min-w-0";
	if (layout.width === "1/2") return "min-w-0 basis-full md:basis-1/2";
	if (layout.width === "1/3") return "min-w-0 basis-full md:basis-1/3";
	if (layout.width === "2/3") return "min-w-0 basis-full md:basis-2/3";
	if (layout.width === "auto") return "min-w-fit";
	return "min-w-0 flex-1";
}

function renderPreviewSectionBody(
	componentName: string,
	props: Record<string, unknown>,
	t: ReturnType<typeof useTranslation>["t"],
) {
	const sectionBody = renderAdditionalPreviewSectionBody({
		componentName,
		props,
		t,
	});
	if (sectionBody) return sectionBody;

	return (
		<div className="rounded-md border border-dashed border-border bg-muted p-3 text-xs leading-5 text-muted-foreground">
			{String(sectionFallbackText(componentName, t))}
		</div>
	);
}
