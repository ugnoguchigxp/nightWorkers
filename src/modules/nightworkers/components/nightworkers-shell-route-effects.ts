import { type Dispatch, type SetStateAction, useEffect } from 'react';
import type { NightWorkersWorkspaceState } from '../hooks/useNightWorkersWorkspace';
import type { WorkbenchRouteState } from '../routing/workbench-route-state';
import type { WorkbenchArtifactRef } from '../types';

export type ArtifactPaneFocus =
  | { type: 'closed' }
  | { type: 'project_tree' }
  | { type: 'todo' }
  | { type: 'artifact'; artifact: WorkbenchArtifactRef };

export function useNightWorkersRouteArtifactSync(input: {
  routeState: WorkbenchRouteState;
  workspace: NightWorkersWorkspaceState;
  setArtifactFocus: Dispatch<SetStateAction<ArtifactPaneFocus>>;
  setClearedArtifactContextId: Dispatch<SetStateAction<string | null>>;
}) {
  const { routeState, setArtifactFocus, setClearedArtifactContextId, workspace } = input;
  const routeSessionId = routeState.kind === 'session' ? routeState.sessionId : null;

  useEffect(() => {
    if (!routeSessionId) return;
    if (workspace.activeSessionId === routeSessionId) return;
    workspace.setActiveSessionId(routeSessionId);
  }, [routeSessionId, workspace]);

  useEffect(() => {
    if (routeState.kind !== 'session') {
      setArtifactFocus((current) => (current.type === 'closed' ? current : { type: 'closed' }));
      return;
    }
    const artifact = routeState.artifact;
    if (!artifact) {
      setArtifactFocus((current) => (current.type === 'closed' ? current : { type: 'closed' }));
      return;
    }
    setClearedArtifactContextId(null);
    if (artifact.kind === 'todo') {
      setArtifactFocus((current) => (current.type === 'todo' ? current : { type: 'todo' }));
      return;
    }
    if (artifact.kind === 'project_tree') {
      setArtifactFocus((current) =>
        current.type === 'project_tree' ? current : { type: 'project_tree' }
      );
      if (artifact.filePath && workspace.selectedProjectFilePath !== artifact.filePath) {
        workspace.openProjectFile(artifact.filePath);
      }
      return;
    }
    if (artifact.kind === 'plan_mode_workspace') {
      const existing =
        workspace.activeArtifactRefs.find((item) => item.kind === 'plan_mode_workspace') ||
        workspace.activeArtifactRefs.find((item) => item.kind === 'app_blueprint');
      if (existing) {
        setArtifactFocus((current) => {
          if (
            current.type === 'artifact' &&
            current.artifact.id === existing.id &&
            current.artifact.metadata?.initialTab === artifact.tab
          ) {
            return current;
          }
          return {
            type: 'artifact',
            artifact: {
              ...existing,
              metadata: { ...existing.metadata, initialTab: artifact.tab },
            },
          };
        });
      } else {
        setArtifactFocus((current) => (current.type === 'closed' ? current : { type: 'closed' }));
      }
      return;
    }
    if (artifact.kind === 'review_status') {
      const existing = workspace.activeArtifactRefs.find((item) => item.kind === 'review_status');
      if (existing) {
        setArtifactFocus((current) =>
          current.type === 'artifact' && current.artifact.id === existing.id
            ? current
            : { type: 'artifact', artifact: existing }
        );
        return;
      }
      if (workspace.activeReviewSession) {
        const detail = workspace.activeReviewSession;
        const reviewArtifactId = `review-status-${detail.session.id}`;
        setArtifactFocus((current) => {
          if (current.type === 'artifact' && current.artifact.id === reviewArtifactId) {
            return current;
          }
          return {
            type: 'artifact',
            artifact: {
              id: reviewArtifactId,
              taskId: detail.session.taskId,
              runId: detail.session.runId,
              kind: 'review_status',
              title: 'Review Status',
              summary: `${detail.recommendation.level} · ${detail.statusArtifact.sections.length} sections`,
              source: { type: 'review_result', reviewId: detail.session.id },
              createdAt: detail.session.updatedAt,
              metadata: { reviewSession: detail },
            },
          };
        });
      } else {
        setArtifactFocus((current) => (current.type === 'closed' ? current : { type: 'closed' }));
      }
      return;
    }
    const existing = workspace.activeArtifactRefs.find((item) => item.id === artifact.artifactId);
    if (existing) {
      setArtifactFocus((current) =>
        current.type === 'artifact' && current.artifact.id === existing.id
          ? current
          : { type: 'artifact', artifact: existing }
      );
    } else {
      setArtifactFocus((current) => (current.type === 'closed' ? current : { type: 'closed' }));
    }
  }, [routeState, setArtifactFocus, setClearedArtifactContextId, workspace]);
}
