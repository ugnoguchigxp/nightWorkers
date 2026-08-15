import { and, eq, inArray } from "drizzle-orm";
import {
	type AdoptedCompletionCondition,
	deriveAdoptedCompletionCondition,
	deriveSecurityContractV1,
	type SecurityContractV1,
	writeCompletionConditionCommandSchema,
	writeSecurityContractCommandSchema,
} from "../../../shared/schemas/security-intelligence-runtime.schema";
import { db } from "../../db/client";
import {
	repositories,
	taskRevisionSnapshots,
	tasks,
} from "../../db/schema-base";
import { taskRunTodos } from "../../db/schema-task-execution";
import { taskRuns } from "../../db/schema-task-runs";
import {
	securityAssessmentReceipts,
	securityAssessmentSubjectBindings,
	securityContracts,
} from "../../db/security-intelligence-schema";
import { AppError, NotFoundError } from "../../lib/errors";
import {
	getCurrentSecurityContract,
	saveCompletionConditionWithCas,
	saveSecurityContractWithCas,
} from "./security-intelligence.repository";

type ContractSemanticInput = Omit<
	SecurityContractV1,
	| "version"
	| "contractRef"
	| "contractRevision"
	| "taskId"
	| "taskRevisionSnapshotId"
	| "taskRevision"
	| "taskDigest"
	| "repositoryId"
	| "supersedesContractRef"
	| "contractDigest"
	| "createdAt"
	| "authorPrincipalRef"
>;

export async function writeSecurityContract(rawInput: {
	taskId: string;
	taskRevisionSnapshotId: string;
	expectedCurrentContractRef: string | null;
	expectedHeadRevision: number;
	authorPrincipalRef: string;
	semantic: ContractSemanticInput;
}) {
	const parsed = writeSecurityContractCommandSchema.parse({
		version: 1,
		taskId: rawInput.taskId,
		taskRevisionSnapshotId: rawInput.taskRevisionSnapshotId,
		expectedCurrentContractRef: rawInput.expectedCurrentContractRef,
		expectedHeadRevision: rawInput.expectedHeadRevision,
		semantic: rawInput.semantic,
	});
	const input = { ...parsed, authorPrincipalRef: rawInput.authorPrincipalRef };
	const [subject] = await db
		.select({
			task: tasks,
			snapshot: taskRevisionSnapshots,
			repository: repositories,
			binding: securityAssessmentSubjectBindings,
			receipt: securityAssessmentReceipts,
		})
		.from(tasks)
		.innerJoin(
			taskRevisionSnapshots,
			and(
				eq(taskRevisionSnapshots.id, input.taskRevisionSnapshotId),
				eq(taskRevisionSnapshots.taskId, tasks.id),
			),
		)
		.innerJoin(repositories, eq(repositories.id, tasks.repositoryId))
		.innerJoin(
			securityAssessmentSubjectBindings,
			and(
				eq(
					securityAssessmentSubjectBindings.bindingRef,
					input.semantic.sourceState.assessmentSubjectBindingRef,
				),
				eq(
					securityAssessmentSubjectBindings.taskRevisionSnapshotId,
					input.taskRevisionSnapshotId,
				),
				eq(securityAssessmentSubjectBindings.phase, "pre_implementation"),
			),
		)
		.innerJoin(
			securityAssessmentReceipts,
			eq(
				securityAssessmentReceipts.id,
				securityAssessmentSubjectBindings.assessmentReceiptId,
			),
		)
		.where(eq(tasks.id, input.taskId))
		.limit(1);
	if (!subject) {
		throw new NotFoundError(
			"Task Revision Snapshotにbindingされたpre assessmentが見つかりません。",
		);
	}
	if (
		subject.task.currentRevisionSnapshotId !== input.taskRevisionSnapshotId ||
		subject.snapshot.revision !== subject.task.revision
	) {
		throw new AppError(
			409,
			"SECURITY_CONTRACT_TASK_REVISION_STALE",
			"current Task Revision SnapshotだけがSecurity Contractを更新できます。",
		);
	}
	const normalizedTarget = subject.receipt.normalizedTargetJson as {
		sourceRevision: string;
		targetDigest: string;
	};
	if (
		input.semantic.projectRef !== subject.receipt.canonicalProjectRef ||
		input.semantic.sourceState.revision !== normalizedTarget.sourceRevision ||
		input.semantic.sourceState.targetDigest !== normalizedTarget.targetDigest
	) {
		throw new AppError(
			409,
			"SECURITY_CONTRACT_SOURCE_BINDING_MISMATCH",
			"Security Contractのsource stateがpre assessment receiptと一致しません。",
		);
	}
	if (
		!input.semantic.assessmentSubjectBindingRefs.includes(
			input.semantic.sourceState.assessmentSubjectBindingRef,
		)
	) {
		throw new AppError(
			400,
			"SECURITY_CONTRACT_SOURCE_BINDING_MISSING",
			"source assessment bindingはContractのbinding refsに含める必要があります。",
		);
	}
	const contractBindings = input.semantic.assessmentSubjectBindingRefs.length
		? await db
				.select({
					bindingRef: securityAssessmentSubjectBindings.bindingRef,
					taskId: securityAssessmentSubjectBindings.taskId,
					taskRevisionSnapshotId:
						securityAssessmentSubjectBindings.taskRevisionSnapshotId,
				})
				.from(securityAssessmentSubjectBindings)
				.where(
					inArray(
						securityAssessmentSubjectBindings.bindingRef,
						input.semantic.assessmentSubjectBindingRefs,
					),
				)
		: [];
	if (
		contractBindings.length !==
			input.semantic.assessmentSubjectBindingRefs.length ||
		contractBindings.some(
			(binding) =>
				binding.taskId !== input.taskId ||
				binding.taskRevisionSnapshotId !== input.taskRevisionSnapshotId,
		)
	) {
		throw new AppError(
			409,
			"SECURITY_CONTRACT_FOREIGN_ASSESSMENT_BINDING",
			"Security Contractのassessment bindingは同じTask Revision Snapshotに属する必要があります。",
		);
	}
	const contract = deriveSecurityContractV1({
		version: 1,
		contractRevision: input.expectedHeadRevision + 1,
		taskId: subject.task.id,
		taskRevisionSnapshotId: subject.snapshot.id,
		taskRevision: subject.snapshot.revision,
		taskDigest: subject.snapshot.digest,
		repositoryId: subject.repository.id,
		...input.semantic,
		...(input.expectedCurrentContractRef
			? { supersedesContractRef: input.expectedCurrentContractRef }
			: {}),
		createdAt: new Date().toISOString(),
		authorPrincipalRef: input.authorPrincipalRef,
	});
	return saveSecurityContractWithCas({
		contract,
		expectedCurrentContractRef: input.expectedCurrentContractRef,
		expectedHeadRevision: input.expectedHeadRevision,
	});
}

type ConditionSemanticInput = Omit<
	AdoptedCompletionCondition,
	| "conditionRef"
	| "taskId"
	| "taskRevisionSnapshotId"
	| "taskRevision"
	| "taskDigest"
	| "conditionRevision"
	| "supersedesConditionRef"
	| "conditionDigest"
	| "recordedAt"
	| "authorPrincipalRef"
>;

export async function writeCompletionCondition(rawInput: {
	taskId: string;
	taskRevisionSnapshotId: string;
	expectedCurrentConditionRef: string | null;
	expectedHeadRevision: number;
	authorPrincipalRef: string;
	semantic: ConditionSemanticInput;
}) {
	const parsed = writeCompletionConditionCommandSchema.parse({
		version: 1,
		taskId: rawInput.taskId,
		taskRevisionSnapshotId: rawInput.taskRevisionSnapshotId,
		expectedCurrentConditionRef: rawInput.expectedCurrentConditionRef,
		expectedHeadRevision: rawInput.expectedHeadRevision,
		semantic: rawInput.semantic,
	});
	const input = { ...parsed, authorPrincipalRef: rawInput.authorPrincipalRef };
	const [snapshot] = await db
		.select({ task: tasks, snapshot: taskRevisionSnapshots })
		.from(tasks)
		.innerJoin(
			taskRevisionSnapshots,
			and(
				eq(taskRevisionSnapshots.id, input.taskRevisionSnapshotId),
				eq(taskRevisionSnapshots.taskId, tasks.id),
			),
		)
		.where(eq(tasks.id, input.taskId))
		.limit(1);
	if (!snapshot) throw new NotFoundError("Task Revision Snapshot not found");
	if (
		snapshot.task.currentRevisionSnapshotId !== input.taskRevisionSnapshotId ||
		snapshot.task.revision !== snapshot.snapshot.revision
	) {
		throw new AppError(
			409,
			"COMPLETION_CONDITION_TASK_REVISION_STALE",
			"current Task Revision Snapshotだけがconditionを更新できます。",
		);
	}
	if (input.semantic.subjectRef.startsWith("sic:v1:")) {
		const currentContract = await getCurrentSecurityContract(
			input.taskRevisionSnapshotId,
		);
		if (currentContract?.contract.contractRef !== input.semantic.subjectRef) {
			throw new AppError(
				409,
				"COMPLETION_CONDITION_CONTRACT_STALE",
				"conditionはcurrent Security Contractだけを参照できます。",
			);
		}
	}
	if (input.semantic.source.kind === "coding_agent_todo") {
		const [todo] = await db
			.select({ todo: taskRunTodos, run: taskRuns })
			.from(taskRunTodos)
			.innerJoin(taskRuns, eq(taskRuns.id, taskRunTodos.runId))
			.where(
				and(
					eq(taskRunTodos.runId, input.semantic.source.runId),
					eq(taskRunTodos.todoKey, input.semantic.source.todoKey),
				),
			)
			.limit(1);
		if (
			!todo ||
			todo.run.taskRevisionSnapshotId !== input.taskRevisionSnapshotId ||
			todo.todo.revision !== input.semantic.source.todoRevision ||
			todo.run.todoPlanRevision !== input.semantic.source.todoPlanRevision
		) {
			throw new AppError(
				409,
				"COMPLETION_CONDITION_TODO_REVISION_STALE",
				"TodoまたはTodo plan revisionがcurrentではありません。",
			);
		}
	}
	const condition = deriveAdoptedCompletionCondition({
		taskId: snapshot.task.id,
		taskRevisionSnapshotId: snapshot.snapshot.id,
		taskRevision: snapshot.snapshot.revision,
		taskDigest: snapshot.snapshot.digest,
		conditionRevision: input.expectedHeadRevision + 1,
		...input.semantic,
		...(input.expectedCurrentConditionRef
			? { supersedesConditionRef: input.expectedCurrentConditionRef }
			: {}),
		recordedAt: new Date().toISOString(),
		authorPrincipalRef: input.authorPrincipalRef,
	});
	return saveCompletionConditionWithCas({
		condition,
		expectedCurrentConditionRef: input.expectedCurrentConditionRef,
		expectedHeadRevision: input.expectedHeadRevision,
	});
}

export async function getSecurityContractSnapshot(
	taskRevisionSnapshotId: string,
) {
	const current = await getCurrentSecurityContract(taskRevisionSnapshotId);
	if (!current) return null;
	const history = await db
		.select({ contractRef: securityContracts.contractRef })
		.from(securityContracts)
		.where(
			eq(securityContracts.taskRevisionSnapshotId, taskRevisionSnapshotId),
		);
	return { ...current, historyRefs: history.map((item) => item.contractRef) };
}
