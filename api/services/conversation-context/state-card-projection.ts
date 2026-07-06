import type { NativeApiStateCardRole } from "../agent-runtime/native-api-runner/native-api-mode";
import type {
	ConversationContextSnapshotRecord,
	ConversationContextSnapshotV1,
} from "./types";

export type StateCardProjection = {
	role: NativeApiStateCardRole;
	workKind?: string | null;
	source: "role_projection" | "raw_snapshot" | "omitted";
	omittedSections: string[];
};

export type ProjectedStateCard = {
	stateCardText: string | null;
	projection: StateCardProjection;
};

export function projectConversationStateCardForRuntime(input: {
	snapshot: ConversationContextSnapshotRecord | null;
	role: NativeApiStateCardRole;
	workKind?: string | null;
}): ProjectedStateCard {
	const baseProjection = {
		role: input.role,
		workKind: input.workKind ?? null,
	};
	if (!input.snapshot?.stateCardText.trim()) {
		return {
			stateCardText: null,
			projection: {
				...baseProjection,
				source: "omitted",
				omittedSections: ["empty_snapshot"],
			},
		};
	}

	if (input.role === "implementation") {
		return {
			stateCardText: input.snapshot.stateCardText,
			projection: {
				...baseProjection,
				source: "raw_snapshot",
				omittedSections: [],
			},
		};
	}

	if (input.role === "general_answer") {
		return {
			stateCardText: null,
			projection: {
				...baseProjection,
				source: "omitted",
				omittedSections: ["state_card_not_needed_for_general_answer"],
			},
		};
	}

	const projected = renderRoleProjection(
		input.snapshot.snapshotJson,
		input.role,
	);
	if (!projected.trim()) {
		return {
			stateCardText: null,
			projection: {
				...baseProjection,
				source: "omitted",
				omittedSections: ["projection_empty"],
			},
		};
	}

	return {
		stateCardText: projected,
		projection: {
			...baseProjection,
			source: "role_projection",
			omittedSections: omittedSectionsForRole(input.role),
		},
	};
}

function renderRoleProjection(
	snapshot: ConversationContextSnapshotV1,
	role: NativeApiStateCardRole,
) {
	const lines = [
		`<STATE_CARD role="${role}">`,
		`Task: ${snapshot.task.id} | previousJob=${snapshot.classification.jobType || "unknown"}`,
	];
	const goal = snapshot.classification.goal?.trim();
	if (goal) lines.push(`Goal: ${truncate(goal, 360)}`);
	const request = snapshot.task.latestUserRequest?.trim();
	if (request && (role === "plan" || role === "runtime_debug")) {
		lines.push(`Latest request: ${truncate(request, 360)}`);
	}
	if (snapshot.files.target.length > 0 && role !== "plan") {
		lines.push(`Targets: ${snapshot.files.target.slice(0, 8).join(", ")}`);
	}
	if (
		snapshot.runState.lastFinalReport &&
		(role === "review" || role === "plan")
	) {
		lines.push(
			`Last final report: ${truncate(snapshot.runState.lastFinalReport, 500)}`,
		);
	}
	if (snapshot.runState.lastError) {
		lines.push(`Last error: ${truncate(snapshot.runState.lastError, 360)}`);
	}
	if (snapshot.runState.lastToolFailure && role === "runtime_debug") {
		lines.push(
			`Last tool failure: ${truncate(snapshot.runState.lastToolFailure, 360)}`,
		);
	}
	const evidence = snapshot.runState.workerEvidence;
	if (evidence?.criticalEvidence.length) {
		lines.push(
			`Evidence: ${evidence.criticalEvidence
				.slice(0, 5)
				.map((item) =>
					[item.toolName, item.targetPath, item.reason]
						.filter(Boolean)
						.join(" | "),
				)
				.join(" ; ")}`,
		);
	}
	if (snapshot.contextBaseline?.adoptedArtifactDigest && role === "plan") {
		lines.push(
			`Adopted artifacts: ${snapshot.contextBaseline.adoptedArtifactDigest}`,
		);
	}
	lines.push("</STATE_CARD>");
	return lines.join("\n");
}

function omittedSectionsForRole(role: NativeApiStateCardRole) {
	if (role === "plan") return ["implementation_todos", "code_snippets"];
	if (role === "review")
		return ["implementation_todos", "code_snippets", "planning_detail"];
	if (role === "runtime_debug") return ["planning_detail", "code_snippets"];
	return ["raw_snapshot"];
}

function truncate(value: string, maxChars: number) {
	const normalized = value.replace(/\s+/g, " ").trim();
	return normalized.length > maxChars
		? `${normalized.slice(0, maxChars - 1)}...`
		: normalized;
}
