import { digestText } from "../../text-digest";
import type { AgentRunContext } from "../types";
import {
	buildDeterministicRoleHandoffArtifact,
	type RoleHandoffArtifactV1,
	validateRoleHandoffArtifact,
} from "./native-api-role-handoff";
import {
	buildDeterministicRoleWorkingContext,
	type RoleWorkingContextV1,
	validateRoleWorkingContext,
} from "./native-api-role-working-context";

export type NativeApiRoleContextSnapshot = {
	version: 1;
	source: "deterministic";
	handoff: {
		digest: string;
		eventSeq?: number | null;
		eventId?: string | null;
		omitted: false;
	};
	workingContext: {
		digest: string;
		eventSeq?: number | null;
		eventId?: string | null;
		renderedText: string;
		omitted: false;
	};
};

export function buildNativeApiRoleContextSnapshot(input: {
	context: AgentRunContext;
	createdAt?: string;
}): {
	handoff: RoleHandoffArtifactV1;
	workingContext: RoleWorkingContextV1;
	snapshot: NativeApiRoleContextSnapshot;
} {
	const handoff = buildDeterministicRoleHandoffArtifact({
		context: input.context,
		createdAt: input.createdAt,
	});
	const handoffValidation = validateRoleHandoffArtifact(handoff);
	if (!handoffValidation.ok) {
		throw new Error(
			`Invalid role handoff artifact: ${handoffValidation.errors.join("; ")}`,
		);
	}
	const working = buildDeterministicRoleWorkingContext({
		context: input.context,
		handoff,
		createdAt: input.createdAt,
	});
	const workingValidation = validateRoleWorkingContext(working.context);
	if (!workingValidation.ok) {
		throw new Error(
			`Invalid role working context: ${workingValidation.errors.join("; ")}`,
		);
	}
	return {
		handoff,
		workingContext: working.context,
		snapshot: {
			version: 1,
			source: "deterministic",
			handoff: {
				digest: digestText(JSON.stringify(handoff)),
				omitted: false,
			},
			workingContext: {
				digest: digestText(JSON.stringify(working.context)),
				renderedText: working.renderedText,
				omitted: false,
			},
		},
	};
}

export function readNativeApiRoleWorkingContextText(context: AgentRunContext) {
	const roleContext = readRoleContextRecord(
		context.contextSnapshot.roleContext,
	);
	const workingContext = readRoleContextRecord(roleContext?.workingContext);
	const renderedText = workingContext?.renderedText;
	return typeof renderedText === "string" && renderedText.trim()
		? renderedText.trim()
		: null;
}

function readRoleContextRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}
