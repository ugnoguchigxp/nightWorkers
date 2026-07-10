import type { ProjectQualityController } from "../hooks/useProjectQualityController";
import { QualityReportPanel } from "./QualityReportPanel";

export function QualityScreen({
	controller,
}: {
	controller: ProjectQualityController;
}) {
	return (
		<section className="space-y-3">
			{controller.error ? (
				<div
					className="border px-3 py-2 text-xs"
					style={{
						background: "var(--nw-panel)",
						borderColor: "var(--nw-border)",
						color: "var(--nw-danger)",
					}}
				>
					{controller.error}
				</div>
			) : null}
			<QualityReportPanel
				quality={controller.quality}
				coverageRows={controller.coverageRows}
				e2eRows={controller.e2eRows}
				busy={controller.busy}
				creatingTask={controller.busyAction === "coverage-task"}
				selectedFileKeys={controller.selectedFileKeys}
				notice={controller.notice}
				onRun={(runType) => void controller.run(runType)}
				onToggleFile={controller.toggleFile}
				onCreateTask={() => void controller.createTask()}
			/>
		</section>
	);
}
