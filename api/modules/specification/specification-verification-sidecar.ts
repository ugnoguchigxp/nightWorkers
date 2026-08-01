import type { PlanModeWorkspace } from "../../../shared/schemas/plan-mode-artifact.schema";
import type {
	SpecificationAcceptanceCriterion,
	SpecificationVerificationDocument,
	VerificationCommandPlan,
	VerificationCondition,
} from "../../../shared/schemas/verification-checklist.schema";
import type { CompletionVerificationScope } from "../questionnaire/questionnaire-completion-verification";

type BuildInput = {
	taskId: string;
	specId: string;
	specPath: string;
	content: string;
	sourceMessageIds: string[];
	workspace: PlanModeWorkspace;
	acceptanceCriteria?: SpecificationAcceptanceCriterion[];
	inferConditionSemantics?: boolean;
	completionVerificationScope?: CompletionVerificationScope | null;
	generatedAt?: string;
};

export function buildSpecificationVerificationSidecar(input: BuildInput): {
	content: string;
	document: SpecificationVerificationDocument;
} {
	const annotated = input.acceptanceCriteria
		? {
				content: input.content,
				conditions: input.acceptanceCriteria.map((criterion, index) =>
					buildGeneratedCondition(
						criterion,
						index,
						input.completionVerificationScope ?? null,
					),
				),
			}
		: annotateCompletionConditions(
				input.content,
				input.inferConditionSemantics !== false,
				input.completionVerificationScope ?? null,
			);
	const { content, conditions } = annotated;
	const commands = extractVerificationCommands(content);
	return {
		content,
		document: {
			version: 2,
			specId: input.specId,
			specPath: input.specPath,
			generatedAt: input.generatedAt ?? new Date().toISOString(),
			source: {
				taskId: input.taskId,
				sourceMessageIds: input.sourceMessageIds,
				workspaceArtifactIds: collectWorkspaceArtifactIds(input.workspace),
			},
			...(input.completionVerificationScope
				? { testScope: input.completionVerificationScope }
				: {}),
			conditions,
			commands,
		},
	};
}

function buildGeneratedCondition(
	criterion: SpecificationAcceptanceCriterion,
	index: number,
	completionVerificationScope: CompletionVerificationScope | null,
): VerificationCondition {
	const id = `AC-${String(index + 1).padStart(3, "0")}`;
	const evidence = evidenceForCompletionVerificationScope(
		completionVerificationScope,
		criterion.category,
	);
	return {
		id,
		text: criterion.title,
		category: criterion.category,
		verificationKind: evidence.verificationKind,
		expectedEvidence: evidence.expectedEvidence,
		expectedResult: criterion.title,
		failureMeaning: `${criterion.title} を満たさない場合、この完了条件は未達です。`,
		required: true,
		status: "pending",
	};
}

function annotateCompletionConditions(
	markdown: string,
	inferSemantics: boolean,
	completionVerificationScope: CompletionVerificationScope | null,
): {
	content: string;
	conditions: VerificationCondition[];
} {
	const lines = markdown.split("\n");
	const conditions: VerificationCondition[] = [];
	let inCompletionSection = false;
	let conditionIndex = 1;
	const usedConditionIds = new Set<string>();
	const nextLines = lines.map((line) => {
		const heading = line.match(/^(#{2,6})\s+(.+?)\s*$/);
		if (heading) {
			const title = heading[2] || "";
			inCompletionSection =
				/完了条件|completion conditions?|acceptance criteria/i.test(title) &&
				!/(非対象|out of scope)/i.test(title);
			return line;
		}
		if (!inCompletionSection) return line;
		const bullet = line.match(/^(\s*(?:[-*+]|\d+[.)])\s+)(.+)$/);
		if (!bullet) return line;
		const rawText = bullet[2]?.trim() || "";
		if (!rawText || /^\[[xX]\]/.test(rawText)) return line;
		const text = rawText.replace(/^\[\s\]\s*/, "");
		const typedCondition = text.match(
			/^\[?(AC-\d{3})\]?\s*\[(api|ui|db|validation|auth|workflow|migration|other)\]\s+(.+)$/,
		);
		const existingId = text.match(/^\[?(AC-\d{3})\]?\s*[:：-]?\s*(.+)$/);
		const requestedId = typedCondition?.[1] || existingId?.[1];
		const id =
			requestedId && !usedConditionIds.has(requestedId)
				? requestedId
				: nextAvailableConditionId(usedConditionIds, conditionIndex);
		const conditionText = (
			typedCondition?.[3] ||
			existingId?.[2] ||
			text
		).trim();
		const category = typedCondition?.[2] as
			| VerificationCondition["category"]
			| undefined;
		conditionIndex += 1;
		usedConditionIds.add(id);
		conditions.push(
			buildCondition(
				id,
				conditionText,
				category,
				inferSemantics,
				completionVerificationScope,
			),
		);
		if (requestedId === id) return line;
		if (category) return `${bullet[1]}[${id}][${category}] ${conditionText}`;
		return `${bullet[1]}[${id}] ${conditionText}`;
	});
	return { content: nextLines.join("\n"), conditions };
}

function nextAvailableConditionId(usedIds: Set<string>, startIndex: number) {
	let index = Math.max(1, startIndex);
	let id = `AC-${String(index).padStart(3, "0")}`;
	while (usedIds.has(id)) {
		index += 1;
		id = `AC-${String(index).padStart(3, "0")}`;
	}
	return id;
}

function buildCondition(
	id: string,
	text: string,
	explicitCategory?: VerificationCondition["category"],
	inferSemantics = true,
	completionVerificationScope: CompletionVerificationScope | null = null,
): VerificationCondition {
	if (explicitCategory) {
		const evidence = evidenceForCompletionVerificationScope(
			completionVerificationScope,
			explicitCategory,
		);
		return {
			id,
			text,
			category: explicitCategory,
			verificationKind: evidence.verificationKind,
			expectedEvidence: evidence.expectedEvidence,
			expectedResult: text,
			failureMeaning: `${text} が満たされない場合、この完了条件は未達です。`,
			required: true,
			status: "pending",
		};
	}
	if (!inferSemantics) {
		const evidence = evidenceForCompletionVerificationScope(
			completionVerificationScope,
			"other",
		);
		return {
			id,
			text,
			category: "other",
			verificationKind: evidence.verificationKind,
			expectedEvidence: evidence.expectedEvidence,
			expectedResult: text,
			failureMeaning: `${text} が満たされない場合、この完了条件は未達です。`,
			required: true,
			status: "pending",
		};
	}
	const category = inferCategory(text);
	const verificationKind =
		/manual|手動|目視|確認者|運用/i.test(text) &&
		!/test|テスト|verify|検証コマンド/i.test(text)
			? "manual"
			: /対象外|not applicable/i.test(text)
				? "not_applicable"
				: /verify|typecheck|lint|format|build|coverage|test|テスト|検証コマンド/i.test(
							text,
						)
					? "command_gate"
					: "automated_test";
	return {
		id,
		text,
		category,
		verificationKind,
		expectedEvidence: inferExpectedEvidence(text),
		expectedResult: text,
		failureMeaning: `${text} が満たされない場合、この完了条件は未達です。`,
		required: verificationKind !== "not_applicable",
		status: "pending",
	};
}

function evidenceForCompletionVerificationScope(
	scope: CompletionVerificationScope | null,
	category: VerificationCondition["category"],
): Pick<VerificationCondition, "verificationKind" | "expectedEvidence"> {
	if (!scope) {
		return {
			verificationKind: "automated_test",
			expectedEvidence: ["automated_test"],
		};
	}
	if (scope === "none" || (scope === "e2e_if_ui" && category !== "ui")) {
		return {
			verificationKind: "manual",
			expectedEvidence: ["manual_evidence"],
		};
	}
	if (scope === "unit") {
		return {
			verificationKind: "automated_test",
			expectedEvidence: ["unit_test"],
		};
	}
	if (scope === "e2e_if_ui") {
		return {
			verificationKind: "automated_test",
			expectedEvidence: ["e2e_test"],
		};
	}
	return {
		verificationKind: "automated_test",
		expectedEvidence:
			category === "ui" ? ["unit_test", "e2e_test"] : ["unit_test"],
	};
}

function inferCategory(text: string): VerificationCondition["category"] {
	if (/api|route|endpoint|request|response/i.test(text)) return "api";
	if (/ui|画面|表示|ボタン|操作|コンポーネント/i.test(text)) return "ui";
	if (/db|database|sqlite|migration|table|index|schema/i.test(text))
		return /migration/i.test(text) ? "migration" : "db";
	if (/validation|zod|バリデーション|入力/i.test(text)) return "validation";
	if (/auth|permission|認可|認証/i.test(text)) return "auth";
	if (/workflow|flow|状態|queue|run/i.test(text)) return "workflow";
	if (/lint|format|typecheck|coverage|build|verify|品質/i.test(text))
		return "quality";
	return "other";
}

function inferExpectedEvidence(
	text: string,
): VerificationCondition["expectedEvidence"] {
	const evidence = new Set<VerificationCondition["expectedEvidence"][number]>();
	if (/lint/i.test(text)) evidence.add("lint");
	if (/format/i.test(text)) evidence.add("format_check");
	if (/typecheck/i.test(text)) evidence.add("typecheck");
	if (/coverage/i.test(text)) evidence.add("coverage");
	if (/build/i.test(text)) evidence.add("build");
	if (/migration/i.test(text)) evidence.add("migration_check");
	if (/e2e|playwright/i.test(text)) evidence.add("e2e_test");
	if (/integration/i.test(text)) evidence.add("integration_test");
	if (/manual|手動|目視/i.test(text)) evidence.add("manual_evidence");
	if (/test|テスト|unit|vitest|jest|pytest/i.test(text))
		evidence.add("unit_test");
	if (evidence.size === 0) evidence.add("unit_test");
	return Array.from(evidence);
}

function extractVerificationCommands(
	markdown: string,
): VerificationCommandPlan[] {
	const section = extractSection(markdown, /検証|verification/i);
	const commands: VerificationCommandPlan[] = [];
	for (const match of section.matchAll(
		/`([^`\n]*(?:verify|test|lint|typecheck|format|coverage|build)[^`\n]*)`/gi,
	)) {
		const command = (match[1] || "").trim();
		if (!command || commands.some((item) => item.command === command)) continue;
		commands.push({
			id: `CMD-${String(commands.length + 1).padStart(3, "0")}`,
			label: command,
			command,
			conditionIds: [],
		});
	}
	return commands;
}

function extractSection(markdown: string, headingPattern: RegExp): string {
	const lines = markdown.split("\n");
	const out: string[] = [];
	let active = false;
	for (const line of lines) {
		const heading = line.match(/^(#{2,6})\s+(.+?)\s*$/);
		if (heading) {
			if (active) break;
			active = headingPattern.test(heading[2] || "");
			continue;
		}
		if (active) out.push(line);
	}
	return out.join("\n");
}

function collectWorkspaceArtifactIds(workspace: PlanModeWorkspace): string[] {
	return [
		...(workspace.featurePlanArtifacts || []),
		...(workspace.blueprintArtifacts || []),
		...(workspace.dataModelArtifacts || []),
		...(workspace.dedicatedViewArtifacts || []),
		...(workspace.decisionReviews || []),
		...(workspace.implementationReferences || []),
	].map((artifact) => artifact.id);
}
