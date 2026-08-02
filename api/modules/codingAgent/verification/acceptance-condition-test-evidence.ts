import type { EvidenceAssuranceCondition } from "../../../../shared/modules/codingAgent";
import type { ExpectedEvidence } from "../../../../shared/schemas/verification-checklist.schema";
import type {
	codingAgentTestInventoryCases,
	verificationEvidenceCases,
	verificationEvidenceRuns,
} from "../../../db/verification-schema";

type InventoryCaseRow = typeof codingAgentTestInventoryCases.$inferSelect;
type EvidenceRunRow = typeof verificationEvidenceRuns.$inferSelect;
type EvidenceCaseRow = typeof verificationEvidenceCases.$inferSelect;

export function buildAssuranceTest(input: {
	definition: InventoryCaseRow;
	mappingSource: string;
	evidenceCases: EvidenceCaseRow[];
	currentRunIds: Set<string>;
	runsById: Map<string, EvidenceRunRow>;
}): EvidenceAssuranceCondition["tests"][number] {
	const execution = input.evidenceCases
		.filter((testCase) => testCase.caseKey === input.definition.caseKey)
		.sort((left, right) => {
			const leftRun = input.runsById.get(left.evidenceRunId);
			const rightRun = input.runsById.get(right.evidenceRunId);
			return (
				compareEvidenceRunsNewestFirst(leftRun, rightRun) ||
				executionRiskRank(right.status) - executionRiskRank(left.status) ||
				compareCodeUnits(left.id, right.id)
			);
		})[0];
	const run = execution ? input.runsById.get(execution.evidenceRunId) : null;
	return {
		caseKey: input.definition.caseKey,
		name: input.definition.name,
		filePath: input.definition.filePath,
		runner: input.definition.runner,
		mappingSource: input.mappingSource,
		execution: {
			status:
				run && run.exitCode !== 0
					? "failed"
					: execution
						? normalizeExecutionStatus(execution.status)
						: "not_run",
			evidenceRunId: execution?.evidenceRunId ?? null,
			evidenceKind: normalizeExpectedEvidenceKind(execution?.evidenceKind),
			durationMs: execution?.durationMs ?? null,
			finishedAt: run?.finishedAt.toISOString() ?? null,
		},
		guards: {
			currentSource: Boolean(
				execution && input.currentRunIds.has(execution.evidenceRunId),
			),
			sourceStableDuringExecution: run ? !run.sourceMutatedDuringCheck : null,
			testExecutionObserved: Boolean(run?.testExecutionObserved),
		},
	};
}

export function normalizeExpectedEvidenceKind(
	value: unknown,
): ExpectedEvidence | null {
	if (
		value === "automated_test" ||
		value === "unit_test" ||
		value === "integration_test" ||
		value === "e2e_test" ||
		value === "typecheck" ||
		value === "lint" ||
		value === "format_check" ||
		value === "build" ||
		value === "coverage" ||
		value === "migration_check" ||
		value === "manual_evidence"
	) {
		return value;
	}
	return null;
}

export function latestEvidenceRun<
	T extends Pick<EvidenceRunRow, "finishedAt"> &
		Partial<Pick<EvidenceRunRow, "createdAt" | "id">>,
>(runs: T[]) {
	return [...runs].sort(compareEvidenceRunsNewestFirst)[0];
}

function normalizeExecutionStatus(
	status: string,
): EvidenceAssuranceCondition["tests"][number]["execution"]["status"] {
	if (
		status === "passed" ||
		status === "failed" ||
		status === "skipped" ||
		status === "unknown"
	) {
		return status;
	}
	return "unknown";
}

function compareEvidenceRunsNewestFirst(
	left:
		| (Pick<EvidenceRunRow, "finishedAt"> &
				Partial<Pick<EvidenceRunRow, "createdAt" | "id">>)
		| null
		| undefined,
	right:
		| (Pick<EvidenceRunRow, "finishedAt"> &
				Partial<Pick<EvidenceRunRow, "createdAt" | "id">>)
		| null
		| undefined,
) {
	return (
		(right?.finishedAt.getTime() ?? 0) - (left?.finishedAt.getTime() ?? 0) ||
		(right?.createdAt?.getTime() ?? 0) - (left?.createdAt?.getTime() ?? 0) ||
		compareCodeUnits(right?.id ?? "", left?.id ?? "")
	);
}

function executionRiskRank(status: string) {
	if (status === "failed") return 4;
	if (status === "skipped") return 3;
	if (status === "unknown") return 2;
	return 1;
}

function compareCodeUnits(left: string, right: string) {
	return left < right ? -1 : left > right ? 1 : 0;
}
