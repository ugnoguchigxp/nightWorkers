import type { EditablePlanModeRoutingView } from "../../../../shared/schemas/plan-mode-routing.schema";
import type { PlanModeWorkspace } from "../../nightworkers/types";
import { formatViewLabel } from "./types";

export function PlanArtifactRoutingEditor({
	workspace,
	busyAction,
	disabled,
	onUpdate,
}: {
	workspace: PlanModeWorkspace | null;
	busyAction: string | null;
	disabled: boolean;
	onUpdate?: (
		view: EditablePlanModeRoutingView,
		decision: "include" | "omit",
	) => void | Promise<void>;
}) {
	const routing = workspace?.routing;
	if (!routing) return null;
	return (
		<div className="nightworkers-structured-artifact-card grid gap-3 rounded border p-3 text-xs">
			<div>
				<div className="nightworkers-structured-artifact-text font-semibold">
					Plan Artifact routing
				</div>
				<div className="nightworkers-structured-artifact-muted mt-1">
					Questionnaire と仕様書は必須です。その他は Queue 投入前まで ON / OFF
					を変更できます。
				</div>
			</div>
			<div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
				{routing.entries.map((entry) => {
					const changing = busyAction === `routing:${entry.view}`;
					const locked =
						entry.required ||
						!entry.capabilityEnabled ||
						disabled ||
						!routing.editable ||
						!onUpdate ||
						Boolean(busyAction);
					return (
						<label
							key={entry.view}
							className="nightworkers-structured-artifact-card flex items-start gap-2 rounded border p-2"
						>
							<input
								type="checkbox"
								checked={entry.decision === "include"}
								disabled={locked}
								onChange={(event) => {
									if (entry.required) return;
									void onUpdate?.(
										entry.view as EditablePlanModeRoutingView,
										event.target.checked ? "include" : "omit",
									);
								}}
							/>
							<span className="min-w-0">
								<span className="nightworkers-structured-artifact-text block font-medium">
									{formatViewLabel(entry.view)}{" "}
									{entry.required ? "（必須）" : ""}
									{changing ? " 更新中…" : ""}
								</span>
								{entry.reason ? (
									<span className="nightworkers-structured-artifact-muted mt-0.5 block text-[10px]">
										{entry.reason}
									</span>
								) : null}
								{!entry.capabilityEnabled ? (
									<span className="nightworkers-structured-artifact-warning mt-0.5 block text-[10px]">
										Settings で無効です。
									</span>
								) : null}
							</span>
						</label>
					);
				})}
			</div>
			{routing.lockedReason ? (
				<div className="nightworkers-structured-artifact-warning text-[11px]">
					{routing.lockedReason}
				</div>
			) : null}
			<div className="nightworkers-structured-artifact-muted text-[10px]">
				Routing revision: {routing.revision}
			</div>
		</div>
	);
}
