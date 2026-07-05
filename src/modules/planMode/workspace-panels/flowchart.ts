export function isDiagramDedicatedView(view: string) {
  return view === 'user_flow' || view === 'activity_flow' || view === 'sequence_flow';
}

export function isFlowchartPlanView(view: string) {
  return view === 'user_flow' || view === 'activity_flow';
}

export function extractMermaidChart(content: string) {
  const match = content.match(/```mermaid\s*([\s\S]*?)```/i);
  return match?.[1]?.trim() || null;
}

export function stripMermaidBlocks(content: string) {
  return content.replace(/```mermaid\s*[\s\S]*?```/gi, '').trim();
}

export function buildFlowchartFromMarkdown(content: string, viewKind = '') {
  const labels = extractMarkdownFlowLabels(content).filter(
    (label) => viewKind !== 'user_flow' || isUserFlowLabel(label)
  );
  if (labels.length === 0) return null;
  if (viewKind === 'user_flow' && labels.length < 2) return null;
  const nodes = labels.map((label, index) => `  step${index + 1}["${sanitizeFlowLabel(label)}"]`);
  const edges = labels.slice(1).map((_, index) => `  step${index + 1} --> step${index + 2}`);
  return ['flowchart TD', ...nodes, ...edges].join('\n');
}

export function isUserFlowLabel(label: string) {
  const normalized = label.replace(/`([^`]*)`/g, '$1').trim();
  if (
    /\b[\w-]+\.(css|ts|tsx|js|jsx|json|md|sql|rs|go|py|rb|java|kt|swift|html)\b/i.test(normalized)
  ) {
    return false;
  }
  if (/\b(src|api|tests?|shared|components|modules)\//i.test(normalized)) return false;
  return true;
}

export function extractMarkdownFlowLabels(content: string) {
  const lines = content
    .replace(/```[\s\S]*?```/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const listItems = lines
    .map((line) =>
      line
        .replace(/^\d+[.)]\s+/, '')
        .replace(/^[-*]\s+\[[ xX]\]\s+/, '')
        .replace(/^[-*]\s+/, '')
        .trim()
    )
    .filter((line, index) => line !== lines[index] && line.length > 0);
  if (listItems.length > 0) return listItems;
  return lines
    .filter((line) => !line.startsWith('#'))
    .map((line) => line.replace(/^#+\s*/, '').trim())
    .filter(Boolean);
}

export function sanitizeFlowLabel(label: string) {
  return label
    .replace(/`([^`]*)`/g, '$1')
    .replace(/`/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_~]/g, '')
    .replace(/[{}<>]/g, ' ')
    .replaceAll('[', ' ')
    .replaceAll(']', ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"');
}
