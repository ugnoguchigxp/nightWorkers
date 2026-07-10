import { z } from "zod";
import type {
	WorktreeAdviceRequest,
	WorktreeAdviceResponse,
} from "../../../shared/schemas/gitworktree.schema";
import { worktreeAdviceResponseSchema } from "../../../shared/schemas/gitworktree.schema";
import { NotFoundError } from "../../lib/errors";
import { callStructuredJsonLLM } from "../../services/structured-llm";
import { parseRepairedJsonWithSchema } from "../../services/structured-llm/json";
import * as gitworktreeRepo from "./gitworktree.repository";
import {
	assertGitworktreeAvailable,
	listRepositoryWorktrees,
} from "./gitworktree.service";

const worktreeAdviceDraftSchema = z.object({
	summary: z.string(),
	suggestedBranchName: z.string().nullable(),
	suggestedStartPoint: z.string().nullable(),
	suggestedPathSlug: z.string().nullable(),
	cleanupWorktreeIds: z.array(z.string()),
});

export async function adviseRepositoryWorktrees(
	repositoryId: string,
	request: WorktreeAdviceRequest,
): Promise<WorktreeAdviceResponse> {
	const repository = await gitworktreeRepo.getRepository(repositoryId);
	if (!repository) throw new NotFoundError("Repository not found");
	const data = await listRepositoryWorktrees(repositoryId);
	assertGitworktreeAvailable(data);
	const snapshot = {
		repositoryName: repository.name,
		worktrees: data.worktrees.map((item) => ({
			id: item.id,
			branch: item.branch,
			detached: item.detached,
			isBase: item.isBase,
			head: item.head?.slice(0, 12) || null,
			status: item.removeBlockers.includes("worktree_status_unavailable")
				? "unavailable"
				: item.conflictedCount > 0
					? "conflicted"
					: item.stagedCount + item.modifiedCount + item.untrackedCount > 0
						? "changed"
						: "clean",
			ahead: item.ahead,
			behind: item.behind,
			inUse:
				item.usage.activeTaskCount +
					item.usage.activeRunCount +
					item.usage.pendingCloseoutCount >
				0,
			canRemove: item.canRemove,
			blockerCodes: item.removeBlockers,
			warningCodes: item.removeWarnings,
		})),
		selectedWorktreeId: request.selectedWorktreeId || null,
		taskIntent: request.taskIntent || null,
	};
	const raw = await callStructuredJsonLLM(
		[
			"あなたは Git worktree の読み取り専用アドバイザーです。",
			"確認済みスナップショットだけを根拠に、日本語で簡潔に回答してください。",
			"Git 操作や削除を実行せず、force 操作を提案しないでください。",
			"JSON schema に従ってください。",
		].join("\n"),
		`依頼種別: ${request.kind}\n状態:\n${JSON.stringify(snapshot)}`,
		{
			schemaName: "worktree_advice",
			schema: {
				type: "object",
				additionalProperties: false,
				required: [
					"summary",
					"suggestedBranchName",
					"suggestedStartPoint",
					"suggestedPathSlug",
					"cleanupWorktreeIds",
				],
				properties: {
					summary: { type: "string" },
					suggestedBranchName: { type: ["string", "null"] },
					suggestedStartPoint: { type: ["string", "null"] },
					suggestedPathSlug: { type: ["string", "null"] },
					cleanupWorktreeIds: {
						type: "array",
						items: { type: "string" },
					},
				},
			},
			role: "evaluation",
			workingDirectory: repository.localPath,
			timeoutMs: 30_000,
			allowRawOutputOnJsonParseFailure: true,
		},
	);
	const parsed = parseRepairedJsonWithSchema(raw, worktreeAdviceDraftSchema);
	if (parsed.ok) {
		const removableIds = new Set(
			data.worktrees
				.filter((item) => item.canRemove && !item.isBase)
				.map((item) => item.id),
		);
		return worktreeAdviceResponseSchema.parse({
			...parsed.value,
			cleanupWorktreeIds: parsed.value.cleanupWorktreeIds.filter((id) =>
				removableIds.has(id),
			),
		});
	}
	return {
		summary: raw.trim() || "Worktree の状況を要約できませんでした。",
		suggestedBranchName: null,
		suggestedStartPoint: null,
		suggestedPathSlug: null,
		cleanupWorktreeIds: [],
	};
}
