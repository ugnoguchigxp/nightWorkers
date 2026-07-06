import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
	type DedicatedDesignView,
	dedicatedDesignViewSchema,
	type SpecificationLens,
	specificationLensSchema,
} from "../../../../shared/schemas/plan-mode-artifact.schema";
import { getResourceRoot } from "../../../runtime/paths";
import {
	defaultSupervisorRoutingHypothesis,
	type PlanModeRoutingDecision,
	type SupervisorMode,
	type SupervisorOverlay,
	type SupervisorPhase,
	type SupervisorReferenceDocument,
	type SupervisorReferenceDocumentKind,
	type SupervisorReferenceSectionName,
	type SupervisorRoutingHypothesis,
	type SupervisorWorkKind,
	supervisorModes,
	supervisorOverlays,
	supervisorPhases,
	supervisorWorkKinds,
} from "./types";

const requiredSections: SupervisorReferenceSectionName[] = [
	"Use When",
	"Required Behavior",
	"Stop Conditions",
	"Report Contract",
];

const optionalSections: SupervisorReferenceSectionName[] = [
	"Tool Guidance",
	"Verification Guidance",
	"Risk Notes",
];

const allowedSections = [...requiredSections, ...optionalSections];

export const defaultSupervisorReferencesDirectory = path.join(
	getResourceRoot(),
	"api/services/supervisor/skills/builtin",
);

const cache = new Map<string, SupervisorReferenceDocument[]>();

export function getSupervisorReferencesDirectory(directory?: string): string {
	return (
		directory ||
		process.env.SUPERVISOR_REFERENCES_DIR ||
		process.env.SUPERVISOR_SKILLS_DIR ||
		defaultSupervisorReferencesDirectory
	);
}

export function clearSupervisorReferenceDocumentCache(): void {
	cache.clear();
}

export function listSupervisorReferenceDocuments(
	directory?: string,
): SupervisorReferenceDocument[] {
	const resolvedDirectory = getSupervisorReferencesDirectory(directory);
	const cached = cache.get(resolvedDirectory);
	if (cached) return cached;

	const source =
		resolvedDirectory === defaultSupervisorReferencesDirectory
			? "builtin"
			: "configured";
	const documents = expectedReferencePaths().map((entry) => {
		const filePath = path.join(resolvedDirectory, entry.relativePath);
		if (!fs.existsSync(filePath)) {
			throw new Error(
				`Supervisor reference markdown missing: directory=${resolvedDirectory} relativePath=${entry.relativePath} axis=${entry.kind}`,
			);
		}
		const raw = fs.readFileSync(filePath, "utf8");
		return parseSupervisorReferenceMarkdown(raw, {
			id: entry.id,
			kind: entry.kind,
			relativePath: entry.relativePath,
			source,
		});
	});
	cache.set(resolvedDirectory, documents);
	return documents;
}

export function resolveSupervisorReferenceDocuments(
	routing: Partial<SupervisorRoutingHypothesis> | null | undefined,
	directory?: string,
): SupervisorReferenceDocument[] {
	const normalized = normalizeSupervisorRoutingHypothesis(routing);
	const documents = listSupervisorReferenceDocuments(directory);
	const byPath = new Map(
		documents.map((document) => [document.relativePath, document]),
	);
	const selectedPaths = new Set<string>([
		"SKILL.md",
		"references/router.md",
		`references/phases/${normalized.phase}.md`,
		`references/modes/${normalized.primaryMode}.md`,
		...normalized.secondaryModes.map((mode) => `references/modes/${mode}.md`),
		...normalized.workKinds.map(
			(workKind) => `references/work_kinds/${workKind}.md`,
		),
		...normalized.overlays.map(
			(overlay) => `references/overlays/${overlay}.md`,
		),
	]);
	for (const relativePath of normalized.nextReferenceFiles) {
		if (byPath.has(relativePath)) selectedPaths.add(relativePath);
	}

	return [...selectedPaths].map((relativePath) => {
		const document = byPath.get(relativePath);
		if (!document) {
			throw new Error(
				`Supervisor reference is not allowed or missing: ${relativePath}`,
			);
		}
		return document;
	});
}

export function renderSupervisorReferenceDocuments(
	documents: SupervisorReferenceDocument[],
): string {
	return documents
		.map((document) => {
			const sections = allowedSections
				.filter((section) => document.sections[section])
				.map((section) => `## ${section}\n\n${document.sections[section]}`)
				.join("\n\n");
			return [
				`[Procedure Reference: ${document.relativePath}]`,
				`id=${document.id} kind=${document.kind} source=${document.source} digest=${document.digest}`,
				`# ${document.title}`,
				sections,
			].join("\n");
		})
		.join("\n\n---\n\n");
}

export function summarizeSupervisorReferenceDocuments(
	documents: SupervisorReferenceDocument[],
) {
	return documents.map((document) => ({
		id: document.id,
		kind: document.kind,
		source: document.source,
		relativePath: document.relativePath,
		digest: document.digest,
	}));
}

export function normalizeSupervisorRoutingHypothesis(
	value: Partial<SupervisorRoutingHypothesis> | null | undefined,
): SupervisorRoutingHypothesis {
	const routing = value || {};
	const primaryMode = isSupervisorMode(routing.primaryMode)
		? routing.primaryMode
		: defaultSupervisorRoutingHypothesis.primaryMode;
	const phase = isSupervisorPhase(routing.phase)
		? routing.phase
		: defaultSupervisorRoutingHypothesis.phase;
	const normalized: SupervisorRoutingHypothesis = {
		primaryMode,
		secondaryModes: normalizeArray(routing.secondaryModes).filter(
			isSupervisorMode,
		),
		phase,
		workKinds: normalizeArray(routing.workKinds).filter(isSupervisorWorkKind),
		overlays: normalizeArray(routing.overlays).filter(isSupervisorOverlay),
		subtype:
			typeof routing.subtype === "string" && routing.subtype.trim()
				? routing.subtype
				: undefined,
		requiredEvidence: normalizeArray(routing.requiredEvidence),
		nextReferenceFiles: normalizeArray(routing.nextReferenceFiles),
		confidence:
			typeof routing.confidence === "number" &&
			Number.isFinite(routing.confidence)
				? Math.max(0, Math.min(1, routing.confidence))
				: defaultSupervisorRoutingHypothesis.confidence,
	};
	const planMode = normalizePlanModeRoutingDecision(
		routing.planMode,
		normalized,
	);
	if (planMode) normalized.planMode = planMode;
	return normalized;
}

function parseSupervisorReferenceMarkdown(
	raw: string,
	metadata: {
		id: string;
		kind: SupervisorReferenceDocumentKind;
		relativePath: string;
		source: "builtin" | "configured";
	},
): SupervisorReferenceDocument {
	const normalized = raw.replace(/\r\n/g, "\n").trim();
	const title =
		normalized.match(/^#\s+(.+)$/m)?.[1]?.trim() || titleFromId(metadata.id);
	const sections = extractSections(normalized, metadata.relativePath);
	const digestInput = {
		id: metadata.id,
		kind: metadata.kind,
		title,
		sections,
		raw: normalized,
	};
	return {
		id: metadata.id,
		kind: metadata.kind,
		title,
		version: 1,
		source: metadata.source,
		relativePath: metadata.relativePath,
		digest: `sha256:${createHash("sha256").update(JSON.stringify(digestInput), "utf8").digest("hex")}`,
		sections,
	};
}

function extractSections(
	body: string,
	relativePath: string,
): Partial<Record<SupervisorReferenceSectionName, string>> {
	const sections: Partial<Record<SupervisorReferenceSectionName, string>> = {};
	const headingPattern = /^##\s+(.+)$/gm;
	const headings: Array<{ name: string; index: number; contentStart: number }> =
		[];
	let match = headingPattern.exec(body);
	while (match) {
		headings.push({
			name: match[1].trim(),
			index: match.index,
			contentStart: headingPattern.lastIndex,
		});
		match = headingPattern.exec(body);
	}
	for (let index = 0; index < headings.length; index += 1) {
		const heading = headings[index];
		if (!isAllowedSection(heading.name)) continue;
		const nextHeading = headings[index + 1];
		sections[heading.name] = body
			.slice(heading.contentStart, nextHeading?.index ?? body.length)
			.trim();
	}
	for (const section of requiredSections) {
		if (!sections[section]) {
			throw new Error(
				`Supervisor reference markdown missing section: ${section}. relativePath=${relativePath}`,
			);
		}
	}
	return sections;
}

function expectedReferencePaths(): Array<{
	id: string;
	kind: SupervisorReferenceDocumentKind;
	relativePath: string;
}> {
	return [
		{ id: "root", kind: "root", relativePath: "SKILL.md" },
		{ id: "router", kind: "router", relativePath: "references/router.md" },
		...supervisorPhases.map((id) => ({
			id,
			kind: "phase" as const,
			relativePath: `references/phases/${id}.md`,
		})),
		...supervisorModes.map((id) => ({
			id,
			kind: "mode" as const,
			relativePath: `references/modes/${id}.md`,
		})),
		...supervisorWorkKinds.map((id) => ({
			id,
			kind: "work_kind" as const,
			relativePath: `references/work_kinds/${id}.md`,
		})),
		...supervisorOverlays.map((id) => ({
			id,
			kind: "overlay" as const,
			relativePath: `references/overlays/${id}.md`,
		})),
	];
}

function normalizeArray(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value.filter(
		(item): item is string =>
			typeof item === "string" && item.trim().length > 0,
	);
}

function isSupervisorPhase(value: unknown): value is SupervisorPhase {
	return (
		typeof value === "string" &&
		supervisorPhases.includes(value as SupervisorPhase)
	);
}

function isSupervisorMode(value: unknown): value is SupervisorMode {
	return (
		typeof value === "string" &&
		supervisorModes.includes(value as SupervisorMode)
	);
}

function isSupervisorWorkKind(value: unknown): value is SupervisorWorkKind {
	return (
		typeof value === "string" &&
		supervisorWorkKinds.includes(value as SupervisorWorkKind)
	);
}

function isSupervisorOverlay(value: unknown): value is SupervisorOverlay {
	return (
		typeof value === "string" &&
		supervisorOverlays.includes(value as SupervisorOverlay)
	);
}

function normalizePlanModeRoutingDecision(
	value: unknown,
	routing: Pick<SupervisorRoutingHypothesis, "primaryMode" | "phase">,
): PlanModeRoutingDecision | undefined {
	if (!value || typeof value !== "object") return undefined;
	if (routing.primaryMode !== "planning" && routing.phase !== "plan")
		return undefined;

	const candidate = value as Record<string, unknown>;
	if (candidate.primaryArtifact !== "feature_plan") return undefined;

	const dedicatedViews: PlanModeRoutingDecision["dedicatedViews"] = [];
	const seenViews = new Set<DedicatedDesignView>();
	if (Array.isArray(candidate.dedicatedViews)) {
		for (const item of candidate.dedicatedViews) {
			if (!item || typeof item !== "object") continue;
			const decisionCandidate = item as Record<string, unknown>;
			const view = dedicatedDesignViewSchema.safeParse(decisionCandidate.view);
			if (!view.success || seenViews.has(view.data)) continue;
			if (
				decisionCandidate.decision !== "include" &&
				decisionCandidate.decision !== "omit"
			) {
				continue;
			}
			seenViews.add(view.data);
			dedicatedViews.push({
				view: view.data,
				decision: decisionCandidate.decision,
				reason: normalizePlanModeReason(decisionCandidate.reason),
			});
		}
	}

	const specificationLenses: SpecificationLens[] = [];
	const seenLenses = new Set<SpecificationLens>();
	if (Array.isArray(candidate.specificationLenses)) {
		for (const item of candidate.specificationLenses) {
			const lens = specificationLensSchema.safeParse(item);
			if (!lens.success || seenLenses.has(lens.data)) continue;
			seenLenses.add(lens.data);
			specificationLenses.push(lens.data);
		}
	}

	return {
		primaryArtifact: "feature_plan",
		dedicatedViews,
		specificationLenses,
	};
}

function normalizePlanModeReason(value: unknown): string {
	return typeof value === "string" && value.trim()
		? value.trim()
		: "not specified by routing";
}

function isAllowedSection(
	value: string,
): value is SupervisorReferenceSectionName {
	return allowedSections.includes(value as SupervisorReferenceSectionName);
}

function titleFromId(value: string): string {
	return value
		.split("_")
		.map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
		.join(" ");
}
