import type { ImplementationPlan } from "../../../../shared/modules/agentsShare";
import {
	loadCodingAgentContextPacket,
	TodoMutationService,
} from "../../codingAgent";
import * as repo from "../nightworkers.repository";

export async function resolveTaskRunRevisionBinding(input: {
	task: NonNullable<Awaited<ReturnType<typeof repo.getTask>>>;
	resuming: boolean;
}) {
	if (input.resuming) return null;
	const snapshot = input.task.currentRevisionSnapshotId
		? await repo.getTaskRevisionSnapshot(input.task.currentRevisionSnapshotId)
		: null;
	if (
		!snapshot ||
		snapshot.taskId !== input.task.id ||
		snapshot.revision !== input.task.revision
	) {
		throw new Error(
			"Taskの現在revision snapshotを確定できないためRunを開始できません。",
		);
	}
	return snapshot;
}

export async function materializeAdoptedImplementationPlan(input: {
	runId: string;
	plan: ImplementationPlan | null;
	created: boolean;
}) {
	if (!input.created || !input.plan) return;
	const packet = await loadCodingAgentContextPacket(input.runId);
	if (!packet) throw new Error("Coding Agent context packet is unavailable.");
	const materialized = await new TodoMutationService(
		packet.systemContext,
		"agent",
	).execute(input.runId, { op: "plan", steps: input.plan.steps });
	if (!materialized.ok) {
		throw new Error(
			`Adopted implementation plan could not be materialized: ${materialized.error.code}`,
		);
	}
}

export function assertResumedWorkspaceBinding(input: {
	resuming: boolean;
	run: {
		workspaceId: string | null;
		workspaceAllocationVersion: number | null;
		repositoryIdentityRevision: number | null;
	};
	admission:
		| {
				workspace: {
					id: string;
					allocationVersion: number;
					repositoryIdentityRevision: number | null;
				};
		  }
		| null
		| undefined;
}) {
	if (!input.resuming) return;
	if (
		!input.admission ||
		input.run.workspaceId !== input.admission.workspace.id ||
		input.run.workspaceAllocationVersion !==
			input.admission.workspace.allocationVersion ||
		input.run.repositoryIdentityRevision !==
			input.admission.workspace.repositoryIdentityRevision
	) {
		throw new Error(
			"再開対象Runのworkspace bindingが現在のTask workspaceと一致しません。",
		);
	}
}

export function assertResumedTaskRevisionBinding(input: {
	resuming: boolean;
	task: {
		revision: number;
		currentRevisionSnapshotId: string | null;
	};
	run: {
		taskRevision: number | null;
		taskRevisionSnapshotId: string | null;
	};
}) {
	if (!input.resuming) return;
	if (
		!input.task.currentRevisionSnapshotId ||
		input.run.taskRevisionSnapshotId !== input.task.currentRevisionSnapshotId ||
		input.run.taskRevision !== input.task.revision
	) {
		throw new Error(
			"再開対象RunのTask revisionが現在のTask revisionと一致しません。",
		);
	}
}

export function assertResumedRunBindings(input: {
	resuming: boolean;
	task: Parameters<typeof assertResumedTaskRevisionBinding>[0]["task"];
	run: Parameters<typeof assertResumedTaskRevisionBinding>[0]["run"] &
		Parameters<typeof assertResumedWorkspaceBinding>[0]["run"];
	admission: Parameters<typeof assertResumedWorkspaceBinding>[0]["admission"];
}) {
	assertResumedTaskRevisionBinding(input);
	assertResumedWorkspaceBinding(input);
}
