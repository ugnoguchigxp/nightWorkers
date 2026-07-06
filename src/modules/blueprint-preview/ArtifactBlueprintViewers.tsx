import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { BlueprintPreview } from "./BlueprintPreview";

export function BlueprintArtifactViewer({
	sessionId,
	messageId,
	blueprint,
	validation,
	generation,
}: {
	sessionId: string | null;
	messageId: string | null;
	blueprint: Record<string, unknown>;
	validation: unknown;
	generation?: unknown;
}) {
	const { t } = useTranslation();
	const screens = toObjectArray(blueprint.screens);
	const issues = isObject(validation) ? toObjectArray(validation.issues) : [];
	const llmUsage = getLlmUsageSnapshot(generation);
	return (
		<div className="h-full overflow-y-auto px-6 py-5 text-sm text-slate-100">
			<div className="grid gap-4">
				<BlueprintSection title={t("artifact.designPreview")}>
					<BlueprintPreview
						key={String(
							blueprint.id ||
								blueprint.name ||
								screens[0]?.id ||
								"draft-blueprint",
						)}
						sessionId={sessionId}
						messageId={messageId}
						blueprint={blueprint}
						screens={screens}
						validationIssues={issues}
					/>
				</BlueprintSection>
				{llmUsage ? (
					<BlueprintSection title={t("artifact.llmUsage")}>
						<div className="grid gap-2 rounded border border-slate-700/80 bg-slate-950/20 p-3 text-xs sm:grid-cols-3">
							<UsageMetric
								label={t("artifact.llmUsageInput")}
								value={formatTokenCount(llmUsage.inputTokens)}
							/>
							<UsageMetric
								label={t("artifact.llmUsageOutput")}
								value={formatTokenCount(llmUsage.outputTokens)}
							/>
							<UsageMetric
								label={t("artifact.llmUsageTotal")}
								value={formatTokenCount(llmUsage.totalTokens)}
							/>
							<div className="text-slate-400 sm:col-span-3">
								{formatUsageContext(llmUsage)}
							</div>
						</div>
					</BlueprintSection>
				) : null}
				<PromptDetail>
					<BlueprintSection title={t("artifact.screenComposition")}>
						{screens.map((screen, _index) => (
							<div
								key={String(
									screen?.id || screen?.name || JSON.stringify(screen),
								)}
								className="rounded border border-slate-700/80 p-3"
							>
								<div className="flex items-center justify-between gap-3">
									<span className="font-medium text-slate-100">
										{String(screen?.name || screen?.id)}
									</span>
									<span className="text-[11px] text-slate-500">
										{String(screen?.componentName || "")}
									</span>
								</div>
								<div className="mt-2 grid gap-1">
									{toObjectArray(screen.sections).map(
										(section, sectionIndex) => (
											<div
												key={String(section?.id || sectionIndex)}
												className="flex items-center justify-between gap-3 text-xs"
											>
												<span className="min-w-0 truncate text-slate-300">
													{String(section?.name || section?.id)}
												</span>
												<span className="shrink-0 text-slate-500">
													{String(section?.componentName || "")}
												</span>
											</div>
										),
									)}
								</div>
							</div>
						))}
					</BlueprintSection>
					<BlueprintSection title={t("artifact.validationIssues")}>
						{issues.length > 0 ? (
							issues.map((issue, _index) => (
								<div
									key={`${String(issue?.path || "$")}-${String(issue?.message || issue?.code || "")}`}
									className="rounded border border-amber-700/70 bg-amber-950/20 p-2 text-xs"
								>
									<div className="font-mono text-amber-100">
										{String(issue?.path || "$")}
									</div>
									<div className="mt-1 text-amber-50">
										{String(issue?.message || issue?.code || "")}
									</div>
								</div>
							))
						) : (
							<div className="rounded border border-emerald-700/60 bg-emerald-950/20 p-2 text-xs text-emerald-100">
								{t("artifact.noValidationIssues")}
							</div>
						)}
					</BlueprintSection>
				</PromptDetail>
			</div>
		</div>
	);
}

export function ComponentDesignArtifactViewer({
	artifact,
}: {
	artifact: Record<string, unknown>;
}) {
	const { t } = useTranslation();
	const variants = toObjectArray(artifact.variants);
	const tokenChanges = toObjectArray(artifact.tokenChanges);
	const discussionPrompts = Array.isArray(artifact.discussionPrompts)
		? artifact.discussionPrompts.map(String)
		: [];
	return (
		<div className="h-full overflow-y-auto px-6 py-5 text-sm text-slate-100">
			<div className="mb-5 border-slate-700 border-b pb-4">
				<div className="text-xs font-semibold uppercase text-cyan-200">
					{t("artifact.componentDesign")}
				</div>
				<h1 className="mt-1 text-xl font-semibold text-slate-50">
					{String(artifact.componentName || t("artifact.componentFallback"))}
				</h1>
				<div className="mt-1 text-xs text-slate-400">
					{String(artifact.scope || "")}
				</div>
				<p className="mt-3 line-clamp-3 text-xs leading-5 text-slate-300">
					{String(artifact.summary || t("artifact.noSummary"))}
				</p>
			</div>
			<div className="grid gap-4">
				<BlueprintSection title={t("artifact.variantPreview")}>
					<div className="grid gap-3 sm:grid-cols-2">
						{variants.map((variant, _index) => (
							<div
								key={String(variant.name || JSON.stringify(variant))}
								className="rounded border border-slate-700/80 bg-slate-950/20 p-3"
							>
								<div className="mb-3 flex items-center justify-between gap-3">
									<span className="text-xs font-medium text-slate-100">
										{String(variant.name || "variant")}
									</span>
									<span className="text-[10px] uppercase text-slate-500">
										{t("artifact.button")}
									</span>
								</div>
								<button
									type="button"
									className={componentButtonClass(
										String(variant.name || "primary"),
									)}
								>
									{buttonLabelForVariant(String(variant.name || "primary"), t)}
								</button>
								<p className="mt-3 text-[11px] leading-4 text-slate-400">
									{String(variant.purpose || "")}
								</p>
								<div className="mt-2 flex flex-wrap gap-1">
									{(Array.isArray(variant.states) ? variant.states : []).map(
										(state) => (
											<span
												key={String(state)}
												className="rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-300"
											>
												{String(state)}
											</span>
										),
									)}
								</div>
							</div>
						))}
					</div>
				</BlueprintSection>
				<BlueprintSection title={t("artifact.tokenChanges")}>
					{tokenChanges.map((change, _index) => (
						<div
							key={String(
								change.token || change.value || JSON.stringify(change),
							)}
							className="rounded border border-slate-700/80 p-3 text-xs"
						>
							<div className="font-medium text-slate-100">
								{String(change.token || "")}
							</div>
							<div className="mt-2 grid gap-2 md:grid-cols-2">
								<TokenValue
									label={t("artifact.before")}
									value={String(change.before || "")}
								/>
								<TokenValue
									label={t("artifact.proposed")}
									value={String(change.proposed || "")}
								/>
							</div>
							<p className="mt-2 leading-5 text-slate-400">
								{String(change.rationale || "")}
							</p>
						</div>
					))}
				</BlueprintSection>
				<BlueprintSection title={t("artifact.discussion")}>
					{discussionPrompts.map((prompt, _index) => (
						<div
							key={prompt}
							className="rounded border border-slate-700/80 p-2 text-xs text-slate-300"
						>
							{prompt}
						</div>
					))}
				</BlueprintSection>
			</div>
		</div>
	);
}

function TokenValue({ label, value }: { label: string; value: string }) {
	return (
		<div className="rounded border border-slate-800 bg-slate-950/25 p-2">
			<div className="text-[10px] uppercase text-slate-500">{label}</div>
			<div className="mt-1 text-slate-200">{value}</div>
		</div>
	);
}

function UsageMetric({ label, value }: { label: string; value: string }) {
	return (
		<div>
			<div className="text-[10px] uppercase text-slate-500">{label}</div>
			<div className="mt-1 font-mono text-slate-100">{value}</div>
		</div>
	);
}

function componentButtonClass(variant: string): string {
	const base =
		"inline-flex h-9 min-w-24 items-center justify-center rounded border px-3 text-xs font-medium";
	if (variant === "danger")
		return `${base} border-rose-500/70 bg-rose-600 text-white`;
	if (variant === "secondary")
		return `${base} border-slate-600 bg-slate-800 text-slate-100`;
	if (variant === "icon-only")
		return `${base} w-9 min-w-9 border-slate-600 bg-slate-900 text-cyan-100`;
	return `${base} border-cyan-400/70 bg-cyan-500 text-slate-950`;
}

function buttonLabelForVariant(
	variant: string,
	t: (key: string) => string,
): string {
	if (variant === "danger") return t("artifact.action.delete");
	if (variant === "secondary") return t("artifact.action.cancel");
	if (variant === "icon-only") return "+";
	return t("artifact.action.save");
}

function BlueprintSection({
	title,
	children,
}: {
	title: string;
	children: ReactNode;
}) {
	return (
		<section>
			<h2 className="mb-2 text-xs font-semibold uppercase text-slate-400">
				{title}
			</h2>
			<div className="grid gap-2">{children}</div>
		</section>
	);
}

function PromptDetail({ children }: { children: ReactNode }) {
	const { t } = useTranslation();

	return (
		<details className="rounded border border-slate-800 bg-slate-950/20">
			<summary className="cursor-pointer select-none px-3 py-2 text-xs font-semibold uppercase text-slate-400 hover:text-slate-200">
				{t("artifact.promptDetail")}
			</summary>
			<div className="grid gap-4 border-slate-800 border-t p-3">{children}</div>
		</details>
	);
}

function isObject(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function toObjectArray(value: unknown): Array<Record<string, unknown>> {
	return Array.isArray(value) ? value.filter(isObject) : [];
}

type LlmUsageSnapshot = {
	provider: string;
	model: string | null;
	usageMode: string;
	inputTokens: number;
	outputTokens: number;
	totalTokens: number;
	durationMs: number | null;
};

function getLlmUsageSnapshot(generation: unknown): LlmUsageSnapshot | null {
	if (!isObject(generation) || !isObject(generation.llmUsage)) return null;
	const usage = generation.llmUsage;
	return {
		provider: String(usage.provider || ""),
		model: usage.model ? String(usage.model) : null,
		usageMode: String(usage.usageMode || ""),
		inputTokens: toFiniteNumber(usage.inputTokens),
		outputTokens: toFiniteNumber(usage.outputTokens),
		totalTokens: toFiniteNumber(usage.totalTokens),
		durationMs:
			typeof usage.durationMs === "number" && Number.isFinite(usage.durationMs)
				? Math.max(0, Math.floor(usage.durationMs))
				: null,
	};
}

function toFiniteNumber(value: unknown) {
	return typeof value === "number" && Number.isFinite(value)
		? Math.max(0, Math.floor(value))
		: 0;
}

function formatTokenCount(value: number) {
	return `${value.toLocaleString()} tokens`;
}

function formatUsageContext(usage: LlmUsageSnapshot) {
	return [
		[usage.provider, usage.model].filter(Boolean).join(" / "),
		usage.usageMode,
		usage.durationMs === null
			? null
			: `${(usage.durationMs / 1000).toFixed(1)}s`,
	]
		.filter(Boolean)
		.join(" · ");
}
