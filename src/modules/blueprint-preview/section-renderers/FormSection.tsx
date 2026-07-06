import { PreviewButton, PreviewField } from "../BlueprintPreviewPrimitives";
import { previewColumns, toObjectArray } from "../previewModel";
import type { SectionRendererInput } from "./types";

export function renderFormSection({ props, t }: SectionRendererInput) {
	const propFields = toObjectArray(props.fields);
	const fields: Record<string, unknown>[] =
		propFields.length > 0
			? propFields.slice(0, 5)
			: previewColumns(props)
					.slice(0, 5)
					.map((field) => ({
						key: field.key,
						label: field.label,
						type: "text",
					}));
	return (
		<div className="grid gap-[var(--blueprint-preview-gap)]">
			{fields.map((field, index) => (
				<div
					className="grid gap-1.5"
					key={String(
						field.key || field.name || field.label || JSON.stringify(field),
					)}
				>
					<span className="text-[11px] font-medium text-muted-foreground">
						{String(field.label || field.name || `Field ${index + 1}`)}
					</span>
					{field.type === "checkbox" ? (
						<div className="flex min-h-[var(--blueprint-preview-control-height)] items-center gap-2 rounded border border-border bg-card px-3 text-xs text-foreground">
							<span
								className={`grid h-4 w-4 place-items-center rounded border ${
									field.checked === false
										? "border-border bg-background"
										: "border-primary bg-primary"
								}`}
							>
								{field.checked === false ? null : (
									<span className="h-1.5 w-1.5 rounded-full bg-primary-foreground" />
								)}
							</span>
							<span>
								{String(field.label || field.name || `Field ${index + 1}`)}
							</span>
						</div>
					) : field.type === "select" ? (
						<div className="flex min-h-[var(--blueprint-preview-control-height)] items-center justify-between rounded border border-border bg-card px-3 text-xs text-foreground">
							<span>
								{String(
									field.value || field.placeholder || field.label || "Select",
								)}
							</span>
							<span className="text-[10px] text-muted-foreground">v</span>
						</div>
					) : field.type === "textarea" ? (
						<div className="min-h-20 rounded border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
							{String(field.placeholder || field.label || "Enter details")}
						</div>
					) : (
						<PreviewField>
							{String(field.placeholder || field.label || field.name || "")}
						</PreviewField>
					)}
				</div>
			))}
			<PreviewButton className="mt-1 w-fit px-4">
				{String(props.submitLabel || t("artifact.action.save"))}
			</PreviewButton>
		</div>
	);
}
