import { useProjectEvaluationController } from '../hooks/useProjectEvaluationController';
import type { ProjectEvaluationProject } from '../model/projectEvaluationTypes';
import { DimensionSelector } from './DimensionSelector';
import { EvaluationHistorySidebar } from './EvaluationHistorySidebar';
import { EvaluationSummaryPanel } from './EvaluationSummaryPanel';
import { ImprovementIdeaGrid } from './ImprovementIdeaGrid';
import { ProjectEvaluationEmptyState } from './ProjectEvaluationEmptyState';
import { ProjectEvaluationTaskLinks } from './ProjectEvaluationTaskLinks';
import { ProjectEvaluationToolbar } from './ProjectEvaluationToolbar';

export function ProjectEvaluationScreen({ project }: { project: ProjectEvaluationProject }) {
  const controller = useProjectEvaluationController(project.id);
  const detail = controller.detail;

  return (
    <main className="flex h-full min-h-0 flex-col bg-[var(--nw-background)] text-[var(--nw-text)]">
      <ProjectEvaluationToolbar
        error={controller.error}
        evaluation={detail?.evaluation ?? null}
        isRunning={controller.isRunning}
        onRun={controller.runEvaluation}
        project={project}
      />
      <div className="nightworkers-scrollbar min-h-0 flex-1 overflow-auto">
        <div className="min-w-[1120px] space-y-4 p-4">
          {controller.error ? (
            <div className="rounded-md border border-[var(--nw-danger)] bg-[var(--nw-panel)] px-3 py-2 text-[var(--nw-danger)] text-sm">
              {controller.error}
            </div>
          ) : null}
          {!detail ? (
            <ProjectEvaluationEmptyState
              isLoading={controller.isLoading || controller.isRunning}
              onRun={controller.runEvaluation}
            />
          ) : (
            <>
              <EvaluationSummaryPanel
                evaluation={detail.evaluation}
                previous={controller.previousEvaluation}
              />
              <section className="grid grid-cols-[260px_minmax(0,1fr)] gap-4">
                <EvaluationHistorySidebar
                  activeId={detail.evaluation.id}
                  evaluations={controller.history}
                  onSelect={controller.selectEvaluation}
                />
                <DimensionSelector
                  dimensions={detail.evaluation.dimensions}
                  onChange={controller.setSelectedKeys}
                  selectedKeys={controller.selectedKeys}
                />
              </section>
              <ImprovementIdeaGrid
                dimensions={detail.evaluation.dimensions}
                ideas={detail.improvements}
                isCreatingTasks={controller.isCreatingTasks}
                isGenerating={controller.isGenerating}
                onCreateTasks={controller.createTasks}
                onGenerate={controller.generateIdeas}
                onToggleIdea={controller.toggleIdea}
                selectedIdeaIds={controller.selectedIdeaIds}
                selectedKeys={controller.selectedKeys}
              />
              <ProjectEvaluationTaskLinks links={detail.taskLinks} />
            </>
          )}
        </div>
      </div>
    </main>
  );
}
