import { toDeepRecord } from '../../../../shared/json-record';
import type {
  ActivityArtifact,
  ProjectFileContent,
  TaskMessage,
  TaskRun,
  WorkbenchArtifactRef,
} from '../types';

export function buildArtifactVersions(
  selectedArtifact: WorkbenchArtifactRef | null,
  taskMessages: TaskMessage[],
  activityArtifacts: ActivityArtifact[]
): WorkbenchArtifactRef[] {
  if (!selectedArtifact) return [];
  if (selectedArtifact.kind === 'diff') return [selectedArtifact];
  const messageRefs = taskMessages
    .map((message) => taskMessageToArtifactRef(message, selectedArtifact.kind))
    .filter((artifact): artifact is WorkbenchArtifactRef => Boolean(artifact));
  const activityRefs = activityArtifacts
    .map((artifact) => activityArtifactToArtifactRef(artifact, selectedArtifact.kind))
    .filter((artifact): artifact is WorkbenchArtifactRef => Boolean(artifact));
  const byId = new Map<string, WorkbenchArtifactRef>();
  for (const artifact of [...messageRefs, ...activityRefs, selectedArtifact]) {
    byId.set(artifact.id, artifact);
  }
  return [...byId.values()].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );
}

export function buildExportedArtifactContent(input: {
  showDiff: boolean;
  latestRun?: TaskRun;
  selectedMessage: TaskMessage | null;
  selectedActivityArtifact: ActivityArtifact | null;
  selectedFile: ProjectFileContent | null;
  selectedArtifact: WorkbenchArtifactRef | null;
}) {
  if (input.showDiff) return input.latestRun?.diffPatch || '';
  if (input.selectedActivityArtifact?.contentText)
    return input.selectedActivityArtifact.contentText;
  if (input.selectedMessage?.content) return input.selectedMessage.content;
  if (input.selectedFile?.content) return input.selectedFile.content;
  return input.selectedArtifact
    ? JSON.stringify(input.selectedArtifact.metadata || {}, null, 2)
    : '';
}

export async function copyText(content: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(content);
    return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = content;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  document.body.removeChild(textarea);
}

export function saveTextFile(content: string, filename: string) {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function artifactFileName(artifact: WorkbenchArtifactRef) {
  const slug = artifact.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `${slug || 'artifact'}.md`;
}

function taskMessageToArtifactRef(
  message: TaskMessage,
  selectedKind: WorkbenchArtifactRef['kind']
): WorkbenchArtifactRef | null {
  const metadata = toDeepRecord(message.metadataJson);
  const display = toDeepRecord(metadata.display);
  const appBlueprint = toDeepRecord(metadata.appBlueprint);
  const componentDesign = toDeepRecord(metadata.componentDesign);
  const artifactRef = toDeepRecord(metadata.artifactRef);
  const kind = resolveMessageArtifactKind(message);
  if (kind !== selectedKind) return null;
  const title =
    metadata.title ||
    display.title ||
    appBlueprint.name ||
    componentDesign.componentName ||
    'Artifact';
  return {
    id: `message-${message.id}`,
    taskId: message.taskId,
    runId: message.runId || undefined,
    kind,
    title: String(title),
    summary: String(display.summary || message.content.slice(0, 160)),
    source:
      typeof artifactRef.artifactId === 'string'
        ? { type: 'artifact_row', artifactId: artifactRef.artifactId }
        : { type: 'task_message', messageId: message.id },
    createdAt: String(message.createdAt),
    metadata,
  };
}

function activityArtifactToArtifactRef(
  artifact: ActivityArtifact,
  selectedKind: WorkbenchArtifactRef['kind']
): WorkbenchArtifactRef | null {
  const kind = artifact.kind as WorkbenchArtifactRef['kind'];
  if (kind !== selectedKind) return null;
  const metadata = toDeepRecord(artifact.metadataJson);
  const appBlueprint = toDeepRecord(metadata.appBlueprint);
  return {
    id: `artifact-${artifact.id}`,
    taskId: artifact.taskId,
    runId: artifact.runId || undefined,
    kind,
    title: String(metadata.title || appBlueprint.name || artifact.path || artifact.kind),
    summary: String(metadata.summary || artifact.contentText?.slice(0, 160) || ''),
    source: { type: 'artifact_row', artifactId: artifact.id },
    createdAt: String(artifact.createdAt),
    metadata,
  };
}

function resolveMessageArtifactKind(message: TaskMessage): WorkbenchArtifactRef['kind'] | null {
  const metadata = toDeepRecord(message.metadataJson);
  if (metadata.componentDesign) return 'component_design';
  if (metadata.designDelta) return 'design_delta';
  if (metadata.markdownDocumentData || String(metadata.intent) === 'draft_spec') return 'spec';
  if (metadata.appBlueprint || metadata.artifactRef) return 'app_blueprint';
  if (message.messageType === 'markdown_document') return 'spec';
  return null;
}
