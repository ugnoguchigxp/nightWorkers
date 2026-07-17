import {
	CheckCircle2,
	CircleAlert,
	LoaderCircle,
	ShieldCheck,
} from "lucide-react";
import type { ReactNode } from "react";
import type { VerificationEvidenceHistoryContext } from "../../codingAgent";
import type { ActivityEvent, TaskEvent } from "../types";
import { formatFinishedTime } from "../utils/time";
import { LazyDetails } from "./LazyDetails";
import {
	type CodexToolCardModel,
	codexToolCodeBlockMaxHeight,
	getCodexToolCardModel,
	isNormalCodexToolCardVisible,
	statusLabel,
} from "./ThreadTimelineCodexToolCardModel";
import { DiffCodeBlock } from "./ThreadTimelineDiffView";
import { NightWorkersCodeBlock } from "./ThreadTimelineMarkdown";

export {
	getCodexToolCardModel,
	hasCodexToolCard,
	isNormalCodexToolCardVisible,
} from "./ThreadTimelineCodexToolCardModel";
export function CodexToolCard({ event }: { event: TaskEvent | ActivityEvent }) {
	const card = getCodexToolCardModel(event);
	if (!card) return null;

	return (
		<details
			className="nightworkers-chat-card rounded border"
			data-tone="accent"
			open
		>
			<summary className="nightworkers-chat-card-header cursor-pointer list-none px-3 py-2 text-xs">
				<span className="nightworkers-chat-card-badge mr-2 rounded border px-1.5 py-0.5">
					{card.title}
				</span>
				<span className="nightworkers-chat-card-meta">{card.summary}</span>
				{typeof event.seq === "number" ? (
					<span className="nightworkers-chat-card-subtle ml-2">
						#{event.seq}
					</span>
				) : null}
			</summary>
			<CodexToolCardBody card={card} debug />
		</details>
	);
}

export function NormalCodexToolCard({
	event,
	verificationHistory,
}: {
	event: TaskEvent | ActivityEvent;
	verificationHistory?: VerificationEvidenceHistoryContext;
}) {
	const card = getCodexToolCardModel(event);
	if (!card || !isNormalCodexToolCardVisible(card)) return null;

	return (
		<LazyDetails
			className="nightworkers-chat-card overflow-hidden rounded-[var(--radius-md)] border text-sm"
			defaultOpen={
				card.codexKind === "edit_command" ||
				(card.codexKind === "command" && card.lifecycle !== "started")
			}
			summary={
				<summary className="nightworkers-chat-card-header cursor-pointer list-none px-4 py-3">
					{card.verification ? (
						<VerificationCardHeader
							verification={card.verification}
							history={verificationHistory}
						/>
					) : card.codexKind === "command" ? (
						<CommandCardHeader card={card} />
					) : card.codexKind === "edit_command" ? (
						<EditCommandCardHeader card={card} />
					) : (
						<div className="flex items-baseline justify-between gap-4">
							<span className="nightworkers-chat-card-title min-w-0 truncate">
								{card.summary}
							</span>
							<span className="nightworkers-chat-card-meta shrink-0 whitespace-nowrap text-right">
								{card.title}
							</span>
						</div>
					)}
					{!card.verification && card.codexKind !== "command" ? (
						<div className="nightworkers-chat-card-meta mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
							<span>{statusLabel(card)}</span>
							{card.metadata.slice(0, 3).map((item) => (
								<span key={`${item.label}:${item.value}`}>
									{item.label}: {item.value}
								</span>
							))}
						</div>
					) : null}
				</summary>
			}
		>
			<CodexToolCardBody
				card={card}
				verificationHistory={verificationHistory}
			/>
		</LazyDetails>
	);
}

function EditCommandCardHeader({ card }: { card: CodexToolCardModel }) {
	return (
		<div className="flex items-center justify-between gap-4">
			<span className="nightworkers-chat-card-title min-w-0 truncate font-medium">
				{card.summary}
			</span>
			<span className="nightworkers-chat-card-meta shrink-0 whitespace-nowrap text-right">
				コード変更
			</span>
		</div>
	);
}

function CodexToolCardBody({
	card,
	debug = false,
	verificationHistory,
}: {
	card: CodexToolCardModel;
	debug?: boolean;
	verificationHistory?: VerificationEvidenceHistoryContext;
}) {
	const detailLines = [
		`toolName: ${card.toolName}`,
		`lifecycle: ${card.lifecycle}`,
		`status: ${card.status}`,
		card.providerItemId ? `providerItemId: ${card.providerItemId}` : "",
		...card.metadata.map((item) => `${item.label}: ${item.value}`),
		card.errorMessage ? `error: ${card.errorMessage}` : "",
	].filter(Boolean);
	const blocks = [
		detailLines.join("\n"),
		card.argumentsPreview ? `arguments:\n${card.argumentsPreview}` : "",
		card.resultPreview ? `result:\n${card.resultPreview}` : "",
		card.outputPreview ? `output:\n${card.outputPreview}` : "",
	].filter(Boolean);
	if (blocks.length === 0) return null;

	return (
		<div className="nightworkers-chat-card-body border-t">
			{card.verification ? (
				<div className="space-y-3 p-3">
					<VerificationCardDetails
						verification={card.verification}
						history={verificationHistory}
					/>
					{blocks.length > 0 ? (
						<details className="nightworkers-chat-card-item rounded border">
							<summary className="nightworkers-chat-card-meta cursor-pointer list-none px-3 py-2 text-xs">
								内部の実行詳細
							</summary>
							<div className="border-t p-2">
								<NightWorkersCodeBlock
									code={blocks.join("\n\n")}
									filename="run_check.details.txt"
									language="text"
									maxHeight={debug ? 320 : 220}
									syntaxHighlighting={false}
								/>
							</div>
						</details>
					) : null}
				</div>
			) : card.codexKind === "command" ? (
				<CommandCardBody card={card} debug={debug} />
			) : card.editDiffPreview ? (
				<div className="space-y-2 p-3">
					<DiffCodeBlock
						code={card.editDiffPreview.diff}
						label={card.editDiffPreview.label}
					/>
					{card.outputPreview ? (
						<NightWorkersCodeBlock
							code={card.outputPreview}
							filename={card.detailsFilename || `${card.toolName}.output.txt`}
							language="text"
							maxHeight={codexToolCodeBlockMaxHeight(card, debug, "output")}
							syntaxHighlighting={false}
						/>
					) : null}
				</div>
			) : (
				<NightWorkersCodeBlock
					code={blocks.join("\n\n")}
					filename={card.detailsFilename || `${card.toolName}.txt`}
					language="text"
					maxHeight={codexToolCodeBlockMaxHeight(card, debug, "details")}
					syntaxHighlighting={false}
				/>
			)}
		</div>
	);
}

function CommandCardHeader({ card }: { card: CodexToolCardModel }) {
	const outputPreview = card.outputPreview
		?.split(/\r?\n/)
		.map((line) => line.trim())
		.find(Boolean);
	return (
		<>
			<div className="flex items-center justify-between gap-4">
				<span className="nightworkers-chat-card-title min-w-0 truncate font-mono">
					$ {card.command}
				</span>
				<span className="nightworkers-chat-card-meta shrink-0 whitespace-nowrap text-right">
					{commandStateLabel(card)}
				</span>
			</div>
			<div className="nightworkers-chat-card-meta mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
				{card.commandClass ? <span>{card.commandClass}</span> : null}
				{card.exitCode !== undefined ? (
					<span>exit {card.exitCode ?? "pending"}</span>
				) : null}
			</div>
			{outputPreview ? (
				<div className="nightworkers-chat-card-meta mt-1 truncate font-mono text-xs">
					{outputPreview}
				</div>
			) : null}
		</>
	);
}

function CommandCardBody({
	card,
	debug,
}: {
	card: CodexToolCardModel;
	debug: boolean;
}) {
	const result =
		card.outputPreview?.trim() ||
		(card.exitCode !== undefined
			? `exitCode=${card.exitCode ?? "pending"}`
			: commandStateLabel(card));
	return (
		<div className="p-3">
			<NightWorkersCodeBlock
				code={[`$ ${card.command}`, "", result].join("\n")}
				filename="command.sh"
				language="shell"
				maxHeight={debug ? 240 : 160}
				syntaxHighlighting={false}
			/>
		</div>
	);
}

function commandStateLabel(card: CodexToolCardModel) {
	if (card.status === "failed" || card.lifecycle === "failed") return "失敗";
	if (card.lifecycle === "started" || card.lifecycle === "progress")
		return "実行中";
	return "完了";
}

function VerificationCardHeader({
	verification,
	history,
}: {
	verification: NonNullable<CodexToolCardModel["verification"]>;
	history?: VerificationEvidenceHistoryContext;
}) {
	return (
		<>
			<div className="flex items-center justify-between gap-4">
				<div className="flex min-w-0 items-center gap-2">
					<VerificationStateIcon state={verification.state} />
					<span className="nightworkers-chat-card-title min-w-0 truncate font-medium">
						{verification.headline}
					</span>
				</div>
				<span className="nightworkers-chat-card-meta shrink-0 whitespace-nowrap text-right">
					検証
				</span>
			</div>
			<div className="nightworkers-chat-card-meta mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
				{verification.command ? (
					<span className="min-w-0 truncate">{verification.command}</span>
				) : null}
				<span>{verificationEvidenceLabel(verification.evidence)}</span>
				{verification.conditionIds.length > 0 ? (
					<span>完了条件 {verification.conditionIds.join(", ")}</span>
				) : null}
				{history ? <span>{verificationHistoryLabel(history)}</span> : null}
			</div>
		</>
	);
}

function VerificationCardDetails({
	verification,
	history,
}: {
	verification: NonNullable<CodexToolCardModel["verification"]>;
	history?: VerificationEvidenceHistoryContext;
}) {
	return (
		<div className="grid gap-2 text-xs sm:grid-cols-2">
			<VerificationDetailItem
				icon={<VerificationStateIcon state={verification.state} />}
				value={verification.headline}
			/>
			<VerificationDetailItem
				icon={<ShieldCheck className="h-3.5 w-3.5" />}
				value={verificationEvidenceLabel(verification.evidence)}
			/>
			{verification.exitCode !== undefined ? (
				<VerificationDetailItem
					value={`終了コード ${verification.exitCode ?? "未確定"}`}
				/>
			) : null}
			{verification.checklist ? (
				<VerificationDetailItem
					value={formatChecklistSummary(verification.checklist)}
				/>
			) : null}
			{history ? (
				<VerificationDetailItem value={verificationHistoryDetail(history)} />
			) : null}
			{verification.command ? (
				<div className="sm:col-span-2">
					<NightWorkersCodeBlock
						code={[
							`$ ${verification.command}`,
							"",
							verification.resultText || "結果はまだありません。",
						].join("\n")}
						filename="run_check.sh"
						language="shell"
						maxHeight={220}
						syntaxHighlighting={false}
					/>
				</div>
			) : null}
		</div>
	);
}

function verificationHistoryLabel(history: VerificationEvidenceHistoryContext) {
	if (!history.lastFullPass) return "Full Verify成功履歴なし";
	return history.freshness === "current"
		? "実行時点: Full Verify有効"
		: "実行時点: Full Verify後に要再検証";
}

function verificationHistoryDetail(
	history: VerificationEvidenceHistoryContext,
) {
	if (!history.lastFullPass) return "最終Full Verify: 未実行";
	const time = formatFinishedTime(history.lastFullPass.occurredAt);
	const suffix =
		history.freshness === "current"
			? "Current"
			: history.staleReason === "code_changed"
				? "Stale（コード変更後）"
				: "Stale（後続の検証失敗）";
	return `最終Full Verify: ${time || "時刻不明"} · ${suffix}`;
}

function VerificationDetailItem({
	icon,
	value,
}: {
	icon?: ReactNode;
	value: string;
}) {
	return (
		<div className="nightworkers-chat-card-item flex items-center gap-2 rounded border px-3 py-2">
			{icon ? <span className="shrink-0">{icon}</span> : null}
			<span className="nightworkers-chat-card-title">{value}</span>
		</div>
	);
}

function VerificationStateIcon({
	state,
}: {
	state: NonNullable<CodexToolCardModel["verification"]>["state"];
}) {
	if (state === "passed")
		return (
			<CheckCircle2
				className="nightworkers-chat-card-success h-4 w-4"
				aria-hidden
			/>
		);
	if (state === "failed")
		return (
			<CircleAlert
				className="nightworkers-chat-card-danger-text h-4 w-4"
				aria-hidden
			/>
		);
	if (state === "running")
		return (
			<LoaderCircle
				className="nightworkers-chat-card-accent h-4 w-4 animate-spin"
				aria-hidden
			/>
		);
	return (
		<CircleAlert
			className="nightworkers-chat-card-warning h-4 w-4"
			aria-hidden
		/>
	);
}

function verificationEvidenceLabel(
	evidence: NonNullable<CodexToolCardModel["verification"]>["evidence"],
) {
	if (evidence === "saved") return "証跡を保存済み";
	if (evidence === "not_saved") return "証跡は未保存";
	return "証跡を確認中";
}

function formatChecklistSummary(
	checklist: NonNullable<CodexToolCardModel["verification"]>["checklist"],
) {
	if (!checklist) return "";
	if (checklist.complete) return "完了条件をすべて確認済み";
	const pending = checklist.failedRequired + checklist.unknownRequired;
	return `未確認の完了条件 ${pending}件`;
}
