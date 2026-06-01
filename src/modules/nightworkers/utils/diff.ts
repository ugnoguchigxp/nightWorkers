export type ChangedFileSummary = {
  path: string;
  added: number;
  deleted: number;
};

export const getDiffStats = (diff?: string | null) => {
  if (!diff) return { added: 0, deleted: 0 };
  let added = 0;
  let deleted = 0;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) added++;
    if (line.startsWith('-') && !line.startsWith('---')) deleted++;
  }
  return { added, deleted };
};

export const getChangedFiles = (diff?: string | null): ChangedFileSummary[] => {
  if (!diff) return [];
  const lines = diff.split('\n');
  const files: ChangedFileSummary[] = [];
  let current: ChangedFileSummary | null = null;

  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      if (current) files.push(current);
      const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
      current = {
        path: match?.[2] || match?.[1] || 'unknown',
        added: 0,
        deleted: 0,
      };
      continue;
    }
    if (!current) continue;
    if (line.startsWith('+') && !line.startsWith('+++')) current.added += 1;
    if (line.startsWith('-') && !line.startsWith('---')) current.deleted += 1;
  }
  if (current) files.push(current);
  return files;
};
