import {
  Check,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  Loader2,
  Minus,
  Pencil,
  Plus,
  Sparkles,
  Target,
  Trash2,
  Zap,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import type { Mission } from '../../../../../shared/schemas/mission-planner.schema';
import type {
  MissionGoal,
  MissionTaskCandidate,
} from '../../../../../shared/schemas/project-detail.schema';
import { isMissionDeleteInProgress } from './mission-model';
import {
  ActiveChip,
  ComplexityChip,
  EmptyTableRow,
  IconActionButton,
  SectionHeading,
  SectionLabel,
  SizeChip,
} from './ProjectDetailCommon';
import {
  controlStyle,
  mutedTextStyle,
  panelStyle,
  primaryButtonStyle,
  primaryTextStyle,
  subtleTextStyle,
  tableBorderStyle,
} from './styles';
import type { ExpandedState, TaskGenerationTreeRow, UnifiedTaskCandidate } from './types';

export function TaskGenerationTreeTable({
  rows,
  expanded,
  selectedIds,
  selectedCount,
  busy,
  busyAction,
  onAddGoal,
  onCreateSelected,
  onGenerateTaskCandidates,
  onGenerateMissionCandidates,
  onExpandAll,
  onCollapseAll,
  onToggleGoal,
  onToggleMission,
  onToggleSelected,
  onOpenGoal,
  onOpenMission,
  onOpenCandidate,
  onEditGoal,
  onToggleGoalActive,
  onDeleteGoal,
  onDecomposeMission,
  onDeleteMission,
  onCreateCandidate,
  onDismissCandidate,
}: {
  rows: TaskGenerationTreeRow[];
  expanded: ExpandedState;
  selectedIds: string[];
  selectedCount: number;
  busy: boolean;
  busyAction: string | null;
  onAddGoal: () => void;
  onCreateSelected: () => void;
  onGenerateTaskCandidates: () => void;
  onGenerateMissionCandidates: () => void;
  onExpandAll: () => void;
  onCollapseAll: () => void;
  onToggleGoal: (goalId: string) => void;
  onToggleMission: (missionId: string) => void;
  onToggleSelected: (candidateId: string) => void;
  onOpenGoal: (goal: MissionGoal | null) => void;
  onOpenMission: (mission: Mission) => void;
  onOpenCandidate: (candidate: UnifiedTaskCandidate) => void;
  onEditGoal: (goal: MissionGoal) => void;
  onToggleGoalActive: (goal: MissionGoal) => void;
  onDeleteGoal: (goal: MissionGoal) => void;
  onDecomposeMission: (mission: Mission) => void;
  onDeleteMission: (mission: Mission) => void;
  onCreateCandidate: (candidate: UnifiedTaskCandidate) => void;
  onDismissCandidate: (candidate: UnifiedTaskCandidate) => void;
}) {
  const { t } = useTranslation();
  return (
    <section className="space-y-3">
      <SectionHeading
        icon={<Sparkles className="h-4 w-4" />}
        title={t('projectDetail.mission.treeTitle')}
      />
      <div className="overflow-hidden border" style={panelStyle}>
        <div
          className="flex flex-wrap items-center justify-between gap-3 border-b p-3"
          style={tableBorderStyle}
        >
          <SectionLabel
            icon={<Target className="h-4 w-4" />}
            title={t('projectDetail.mission.candidates')}
          />
          <div className="flex flex-wrap items-center justify-end gap-2">
            <div className="flex items-center gap-1">
              <IconActionButton
                label={t('projectDetail.mission.collapseAll')}
                onClick={onCollapseAll}
                disabled={rows.length === 0}
              >
                <Minus className="h-3.5 w-3.5" />
              </IconActionButton>
              <IconActionButton
                label={t('projectDetail.mission.expandAll')}
                onClick={onExpandAll}
                disabled={rows.length === 0}
              >
                <Plus className="h-3.5 w-3.5" />
              </IconActionButton>
            </div>
            <Button
              type="button"
              onClick={onAddGoal}
              disabled={busy}
              className="h-8 px-3 text-xs font-semibold"
              style={controlStyle}
            >
              <Target className="h-3.5 w-3.5" />
              {t('projectDetail.goals.add')}
            </Button>
            <Button
              type="button"
              onClick={onCreateSelected}
              disabled={busy || selectedCount === 0}
              className="h-8 px-3 text-xs font-semibold"
              style={controlStyle}
            >
              {t('projectDetail.mission.createTasks', { count: selectedCount })}
            </Button>
            <Button
              type="button"
              onClick={onGenerateMissionCandidates}
              disabled={busy}
              className="h-8 px-3 text-xs font-semibold"
              style={controlStyle}
            >
              {busyAction === 'goal:generate-mission-candidates' ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              {t('projectDetail.mission.generateMissionCandidates')}
            </Button>
            <Button
              type="button"
              onClick={onGenerateTaskCandidates}
              disabled={busy}
              className="h-8 px-3 text-xs font-semibold"
              style={primaryButtonStyle}
            >
              {busyAction === 'goal:generate-task-candidates' ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Zap className="h-3.5 w-3.5" />
              )}
              {t('projectDetail.mission.generate')}
            </Button>
          </div>
        </div>
        <div className="overflow-x-hidden overflow-y-visible">
          <table className="w-full table-fixed text-xs">
            <colgroup>
              <col className="w-14" />
              <col className="w-14" />
              <col />
              <col className="w-24" />
              <col className="w-20" />
              <col className="w-24" />
              <col className="w-24" />
              <col className="w-20" />
              <col className="w-20" />
              <col className="w-24" />
              <col className="w-[116px]" />
            </colgroup>
            <thead style={subtleTextStyle}>
              <tr>
                <th className="py-2 pl-4 text-left">{t('projectDetail.mission.open')}</th>
                <th className="py-2 text-left">{t('projectDetail.mission.select')}</th>
                <th className="py-2 text-left">{t('projectDetail.field.candidate')}</th>
                <th className="py-2 text-left">{t('projectDetail.field.kind')}</th>
                <th className="py-2 text-right">{t('projectDetail.field.status')}</th>
                <th className="py-2 text-right">{t('projectDetail.field.evalContribution')}</th>
                <th className="py-2 text-right">{t('projectDetail.field.tokenSize')}</th>
                <th className="py-2 text-right">{t('projectDetail.field.importance')}</th>
                <th className="py-2 text-right">{t('projectDetail.field.confidence')}</th>
                <th className="py-2 text-right">{t('projectDetail.field.complexity')}</th>
                <th className="py-2 pr-4 text-right">{t('projectDetail.field.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.length > 0 ? (
                rows.map((row) => (
                  <TaskGenerationTreeRowView
                    key={`${row.kind}:${row.id}`}
                    row={row}
                    expanded={expanded}
                    selectedIds={selectedIds}
                    busy={busy}
                    onToggleGoal={onToggleGoal}
                    onToggleMission={onToggleMission}
                    onToggleSelected={onToggleSelected}
                    onOpenGoal={onOpenGoal}
                    onOpenMission={onOpenMission}
                    onOpenCandidate={onOpenCandidate}
                    onEditGoal={onEditGoal}
                    onToggleGoalActive={onToggleGoalActive}
                    onDeleteGoal={onDeleteGoal}
                    onDecomposeMission={onDecomposeMission}
                    onDeleteMission={onDeleteMission}
                    onCreateCandidate={onCreateCandidate}
                    onDismissCandidate={onDismissCandidate}
                  />
                ))
              ) : (
                <EmptyTableRow colSpan={11} message={t('projectDetail.empty.goals')} />
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function TaskGenerationTreeRowView({
  row,
  expanded,
  selectedIds,
  busy,
  onToggleGoal,
  onToggleMission,
  onToggleSelected,
  onOpenGoal,
  onOpenMission,
  onOpenCandidate,
  onEditGoal,
  onToggleGoalActive,
  onDeleteGoal,
  onDecomposeMission,
  onDeleteMission,
  onCreateCandidate,
  onDismissCandidate,
}: {
  row: TaskGenerationTreeRow;
  expanded: ExpandedState;
  selectedIds: string[];
  busy: boolean;
  onToggleGoal: (goalId: string) => void;
  onToggleMission: (missionId: string) => void;
  onToggleSelected: (candidateId: string) => void;
  onOpenGoal: (goal: MissionGoal | null) => void;
  onOpenMission: (mission: Mission) => void;
  onOpenCandidate: (candidate: UnifiedTaskCandidate) => void;
  onEditGoal: (goal: MissionGoal) => void;
  onToggleGoalActive: (goal: MissionGoal) => void;
  onDeleteGoal: (goal: MissionGoal) => void;
  onDecomposeMission: (mission: Mission) => void;
  onDeleteMission: (mission: Mission) => void;
  onCreateCandidate: (candidate: UnifiedTaskCandidate) => void;
  onDismissCandidate: (candidate: UnifiedTaskCandidate) => void;
}) {
  const { t } = useTranslation();
  const indent = row.depth === 0 ? 'pl-1' : row.depth === 1 ? 'pl-7' : 'pl-12';
  const emptyCell = <span style={mutedTextStyle}>—</span>;

  if (row.kind === 'goal') {
    const goal = row.goal;
    const isExpanded = expanded.goalIds.has(row.id);
    const hasChildren = row.childCounts.missions + row.childCounts.taskCandidates > 0;
    return (
      <tr className="border-t" style={tableBorderStyle}>
        <td className="py-3 pl-4">
          <TreeToggle
            expanded={isExpanded}
            disabled={!hasChildren}
            onClick={() => onToggleGoal(row.id)}
          />
        </td>
        <td className="py-3">{emptyCell}</td>
        <td className={`min-w-0 overflow-hidden py-3 ${indent}`}>
          {goal ? (
            <button
              type="button"
              className="block w-full min-w-0 text-left"
              onClick={() => onOpenGoal(goal)}
            >
              <span className="block truncate font-semibold">{goal.title}</span>
              <span className="mt-0.5 line-clamp-2 text-[10px]" style={subtleTextStyle}>
                {goal.goalText}
              </span>
            </button>
          ) : (
            <div>
              <div className="font-semibold">{t('projectDetail.mission.unassigned')}</div>
              <div className="mt-0.5 text-[10px]" style={subtleTextStyle}>
                {t('projectDetail.mission.unassignedHint')}
              </div>
            </div>
          )}
        </td>
        <td className="py-3">{t('projectDetail.tree.kind.goal')}</td>
        <td className="py-3 text-right">
          {goal ? <ActiveChip active={goal.active} /> : emptyCell}
        </td>
        <td className="py-3 text-right">{emptyCell}</td>
        <td className="py-3 text-right">{emptyCell}</td>
        <td className="py-3 text-right">{emptyCell}</td>
        <td className="py-3 text-right">{emptyCell}</td>
        <td className="py-3 text-right">{emptyCell}</td>
        <td className="py-3 pr-4 text-right">
          {goal ? (
            <div className="flex justify-end gap-1 whitespace-nowrap">
              <IconActionButton label="Edit" onClick={() => onEditGoal(goal)} disabled={busy}>
                <Pencil className="h-3.5 w-3.5" />
              </IconActionButton>
              <IconActionButton
                label={
                  goal.active
                    ? t('projectDetail.status.inactive')
                    : t('projectDetail.status.active')
                }
                onClick={() => onToggleGoalActive(goal)}
                disabled={busy}
              >
                <Check className="h-3.5 w-3.5" />
              </IconActionButton>
              <IconActionButton label="Delete" onClick={() => onDeleteGoal(goal)} disabled={busy}>
                <Trash2 className="h-3.5 w-3.5" />
              </IconActionButton>
            </div>
          ) : (
            emptyCell
          )}
        </td>
      </tr>
    );
  }

  if (row.kind === 'mission') {
    const isExpanded = expanded.missionIds.has(row.id);
    const hasChildren = row.childCounts.taskCandidates > 0;
    const canDeleteMission = !isMissionDeleteInProgress(row.mission.status) && !hasChildren;
    return (
      <tr className="border-t" style={tableBorderStyle}>
        <td className="py-3 pl-4">
          <TreeToggle
            expanded={isExpanded}
            disabled={!hasChildren}
            onClick={() => onToggleMission(row.id)}
          />
        </td>
        <td className="py-3">{emptyCell}</td>
        <td className={`min-w-0 overflow-hidden py-3 ${indent}`}>
          <button
            type="button"
            className="block w-full min-w-0 text-left"
            onClick={() => onOpenMission(row.mission)}
          >
            <span className="block truncate font-semibold">{row.mission.title}</span>
            <span className="mt-0.5 line-clamp-2 text-[10px]" style={subtleTextStyle}>
              {row.mission.goalText}
            </span>
          </button>
        </td>
        <td className="py-3">{t('projectDetail.tree.kind.mission')}</td>
        <td className="py-3 text-right">
          {t(`projectDetail.mission.status.${row.mission.status}`, {
            defaultValue: row.mission.status,
          })}
        </td>
        <td className="py-3 text-right">{emptyCell}</td>
        <td className="py-3 text-right">{emptyCell}</td>
        <td className="py-3 text-right">{emptyCell}</td>
        <td className="py-3 text-right">{emptyCell}</td>
        <td className="py-3 text-right">{emptyCell}</td>
        <td className="py-3 pr-4 text-right">
          <div className="flex justify-end gap-1 whitespace-nowrap">
            <IconActionButton
              label={t('projectDetail.mission.decomposeToTaskCandidates')}
              onClick={() => onDecomposeMission(row.mission)}
              disabled={
                busy || row.mission.status === 'review_pending' || row.mission.status === 'active'
              }
            >
              <Sparkles className="h-3.5 w-3.5" />
            </IconActionButton>
            <IconActionButton
              label={
                hasChildren
                  ? t('projectDetail.mission.deleteMissionBlockedByChildren')
                  : t('projectDetail.mission.deleteMission')
              }
              onClick={() => onDeleteMission(row.mission)}
              disabled={busy || !canDeleteMission}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </IconActionButton>
          </div>
        </td>
      </tr>
    );
  }

  const candidate = row.candidate;
  return (
    <tr className="border-t" style={tableBorderStyle}>
      <td className="py-3 pl-4">{emptyCell}</td>
      <td className="py-3">
        <input
          type="checkbox"
          checked={selectedIds.includes(candidate.id)}
          onChange={() => onToggleSelected(candidate.id)}
          disabled={busy || candidate.status !== 'candidate'}
        />
      </td>
      <td className={`min-w-0 overflow-hidden py-3 ${indent}`}>
        <button
          type="button"
          className="block w-full min-w-0 text-left"
          onClick={() => onOpenCandidate(candidate)}
        >
          <span className="block truncate font-semibold">{candidate.title}</span>
          <span className="mt-0.5 line-clamp-2 text-[10px]" style={subtleTextStyle}>
            {candidate.rationale}
          </span>
        </button>
      </td>
      <td className="py-3">
        <CandidateKindChip kind={candidate.candidateKind} />
      </td>
      <td className="py-3 text-right">
        {t(`projectDetail.mission.status.${candidate.status}`, { defaultValue: candidate.status })}
      </td>
      <td className="py-3 text-right">
        {candidate.evaluationContribution === null ? (
          emptyCell
        ) : (
          <span className="font-semibold" style={primaryTextStyle}>
            +{candidate.evaluationContribution}
          </span>
        )}
      </td>
      <td className="py-3 text-right">
        {candidate.tokenSize ? <SizeChip value={candidate.tokenSize} /> : emptyCell}
      </td>
      <td className="py-3 text-right">
        {candidate.importancePercent === null ? emptyCell : `${candidate.importancePercent}%`}
      </td>
      <td className="py-3 text-right">
        {candidate.confidencePercent === null ? emptyCell : `${candidate.confidencePercent}%`}
      </td>
      <td className="py-3 text-right">
        {candidate.complexity ? <ComplexityChip value={candidate.complexity} /> : emptyCell}
      </td>
      <td className="py-3 pr-4 text-right">
        <div className="flex justify-end gap-1 whitespace-nowrap">
          <IconActionButton
            label={t('projectDetail.mission.createSingleTask')}
            onClick={() => onCreateCandidate(candidate)}
            disabled={busy || candidate.status !== 'candidate'}
          >
            <ClipboardCheck className="h-3.5 w-3.5" />
          </IconActionButton>
          <IconActionButton
            label={t('projectDetail.mission.deleteCandidate')}
            onClick={() => onDismissCandidate(candidate)}
            disabled={busy || candidate.status !== 'candidate'}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </IconActionButton>
        </div>
      </td>
    </tr>
  );
}

function TreeToggle({
  expanded,
  disabled,
  onClick,
}: {
  expanded: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  const { t } = useTranslation();
  return (
    <IconActionButton
      label={
        expanded ? t('projectDetail.mission.collapseRow') : t('projectDetail.mission.expandRow')
      }
      onClick={onClick}
      disabled={disabled}
    >
      {expanded ? (
        <ChevronDown className="h-3.5 w-3.5" />
      ) : (
        <ChevronRight className="h-3.5 w-3.5" />
      )}
    </IconActionButton>
  );
}

function CandidateKindChip({ kind }: { kind: MissionTaskCandidate['candidateKind'] }) {
  const { t } = useTranslation();
  const tone =
    kind === 'feature_entrypoint'
      ? 'var(--nw-primary)'
      : kind === 'constraint_enablement' || kind === 'constraint_verification'
        ? 'var(--nw-warning)'
        : 'var(--nw-muted-text)';
  return (
    <span
      className="inline-flex h-6 max-w-[132px] items-center truncate border px-2 text-[11px] font-semibold"
      style={{
        background: 'color-mix(in srgb, currentColor 9%, var(--nw-panel))',
        borderColor: 'color-mix(in srgb, currentColor 35%, var(--nw-border))',
        borderRadius: 'var(--nw-control-radius)',
        color: tone,
      }}
      title={t(`projectDetail.mission.candidateKind.${kind}`)}
    >
      {t(`projectDetail.mission.candidateKind.${kind}`)}
    </span>
  );
}
