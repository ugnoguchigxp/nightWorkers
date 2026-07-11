import { useState } from "react";
import type { ProjectQualityController } from "../hooks/useProjectQualityController";
import type { CoverageFileRow } from "../model/qualityRows";
import { CoverageFileDrawer } from "./CoverageFileDrawer";
import { QualityReportPanel } from "./QualityReportPanel";

export function QualityScreen({
	controller,
}: {
	controller: ProjectQualityController;
}) {
	const [viewer, setViewer] = useState<{
		runId: string;
		row: CoverageFileRow;
	} | null>(null);
	const coverageRunId = controller.quality?.latestCoverageRun?.id ?? null;

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
				onOpenCoverageFile={(row) => {
					if (coverageRunId) setViewer({ runId: coverageRunId, row });
				}}
				onCreateTask={() => void controller.createTask()}
			/>
			{viewer && viewer.runId === coverageRunId ? (
				<CoverageFileDrawer
					repositoryId={controller.repositoryId}
					runId={viewer.runId}
					row={viewer.row}
					onClose={() => setViewer(null)}
				/>
			) : null}
		</section>
	);
}
