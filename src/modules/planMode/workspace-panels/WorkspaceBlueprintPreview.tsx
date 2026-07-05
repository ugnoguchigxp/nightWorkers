import { BlueprintPreview, mockBlueprintToPreviewBlueprintSafely } from '../../blueprint-preview';
import { MarkdownViewer } from '../../nightworkers/components/ArtifactFileViewers';
import type { ActivityArtifact, TaskMessage } from '../../nightworkers/types';
import { toMs } from '../../nightworkers/workbenchSelectorUtils';
import { isRecord, toRecordArray } from './record-utils';

export function WorkspaceBlueprintPreview({
  sessionId,
  message,
  activityArtifacts = [],
  empty = 'No Blueprint artifact.',
}: {
  sessionId: string | null;
  message: TaskMessage | null;
  activityArtifacts?: ActivityArtifact[];
  empty?: string;
}) {
  const source = previewBlueprintFromSources({ message, activityArtifacts });
  const blueprint = source.blueprint;
  if (!isRecord(blueprint)) {
    if (source.isMockBlueprintCandidate) {
      return <BlueprintPreviewUnavailable />;
    }
    return <MarkdownViewer content={message?.content || empty} />;
  }
  const screens = toRecordArray(blueprint.screens);
  const validation = source.validation;
  const issues = isRecord(validation) ? toRecordArray(validation.issues) : [];
  return (
    <BlueprintPreview
      key={String(blueprint.id || blueprint.name || screens[0]?.id || message?.id || 'blueprint')}
      sessionId={sessionId}
      messageId={message?.id || null}
      blueprint={blueprint}
      screens={screens}
      validationIssues={issues}
    />
  );
}

export function previewBlueprintFromSources({
  message,
  activityArtifacts,
}: {
  message: TaskMessage | null;
  activityArtifacts: ActivityArtifact[];
}) {
  const metadata = isRecord(message?.metadataJson) ? message.metadataJson : {};
  const linkedArtifact = findMessageActivityArtifact(message, activityArtifacts);
  const linkedMetadata = isRecord(linkedArtifact?.metadataJson) ? linkedArtifact.metadataJson : {};
  const linkedContent = parseJsonRecord(linkedArtifact?.contentText);

  const sources = [
    { payload: metadata.mockBlueprint, validation: metadata.validation },
    { payload: linkedMetadata.mockBlueprint, validation: linkedMetadata.validation },
    { payload: linkedContent, validation: linkedMetadata.validation },
    ...(!message
      ? latestBlueprintActivityArtifact(activityArtifacts).map((artifact) => {
          const artifactMetadata = isRecord(artifact.metadataJson) ? artifact.metadataJson : {};
          return {
            payload:
              artifactMetadata.mockBlueprint ||
              artifactMetadata.appBlueprint ||
              parseJsonRecord(artifact.contentText),
            validation: artifactMetadata.validation,
          };
        })
      : []),
    { payload: metadata.appBlueprint, validation: metadata.validation },
  ];

  let sawInvalidMockBlueprint = false;
  for (const source of sources) {
    if (!isRecord(source.payload)) continue;
    if (isMockBlueprintCandidate(source.payload)) {
      const blueprint = mockBlueprintToPreviewBlueprintSafely(source.payload);
      if (!isRecord(blueprint)) {
        sawInvalidMockBlueprint = true;
        continue;
      }
      return {
        blueprint,
        validation: source.validation,
        isMockBlueprintCandidate: true,
      };
    }
    return {
      blueprint: source.payload,
      validation: source.validation,
      isMockBlueprintCandidate: false,
    };
  }
  return { blueprint: null, validation: null, isMockBlueprintCandidate: sawInvalidMockBlueprint };
}

export function findMessageActivityArtifact(
  message: TaskMessage | null,
  activityArtifacts: ActivityArtifact[]
) {
  const metadata = isRecord(message?.metadataJson) ? message.metadataJson : {};
  const artifactRef = isRecord(metadata.artifactRef) ? metadata.artifactRef : {};
  const artifactId = typeof artifactRef.artifactId === 'string' ? artifactRef.artifactId : null;
  if (artifactId) {
    const artifact = activityArtifacts.find((item) => item.id === artifactId);
    if (artifact) return artifact;
  }
  return activityArtifacts.find((artifact) => {
    const artifactMetadata = isRecord(artifact.metadataJson) ? artifact.metadataJson : {};
    return typeof message?.id === 'string' && artifactMetadata.messageId === message.id;
  });
}

export function latestBlueprintActivityArtifact(activityArtifacts: ActivityArtifact[]) {
  return [...activityArtifacts]
    .filter((artifact) => artifact.kind === 'app_blueprint')
    .sort((a, b) => toMs(b.createdAt) - toMs(a.createdAt))
    .slice(0, 1);
}

export function parseJsonRecord(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function isMockBlueprintCandidate(value: unknown) {
  return isRecord(value) && value.artifactKind === 'mock_blueprint';
}

function BlueprintPreviewUnavailable() {
  return (
    <div className="rounded border border-amber-700/70 bg-amber-950/20 p-3 text-xs text-amber-100">
      Blueprint preview is unavailable.
    </div>
  );
}
