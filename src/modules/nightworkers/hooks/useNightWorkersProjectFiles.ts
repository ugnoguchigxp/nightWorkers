import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { apiFetch } from '../../../lib/api-base';
import type { ProjectFileContent, ProjectFileEntry } from '../types';
import type { FolderDir } from './nightWorkersWorkspaceState';

const rootProjectDirectory = '';

export function useNightWorkersProjectFiles(activeProjectId: string | undefined) {
  const [currentBrowserPath, setCurrentBrowserPath] = useState<string | null>(null);
  const [browserDirectories, setBrowserDirectories] = useState<FolderDir[]>([]);
  const [browserParentPath, setBrowserParentPath] = useState<string | null>(null);
  const [selectedProjectFilePath, setSelectedProjectFilePath] = useState<string | null>(null);
  const [projectFileEntriesByDirectory, setProjectFileEntriesByDirectory] = useState<
    Record<string, ProjectFileEntry[]>
  >({});
  const [expandedProjectDirectories, setExpandedProjectDirectories] = useState<
    Record<string, boolean>
  >({});
  const [loadingProjectDirectories, setLoadingProjectDirectories] = useState<
    Record<string, boolean>
  >({});
  const [isBrowserLoading, setIsBrowserLoading] = useState(false);

  const fetchDirectories = async (targetPath?: string) => {
    setIsBrowserLoading(true);
    try {
      const url = targetPath
        ? `/api/utils/browse-folders?path=${encodeURIComponent(targetPath)}`
        : '/api/utils/browse-folders';
      const res = await apiFetch(url);
      if (!res.ok) return;
      const data = (await res.json()) as {
        currentPath: string | null;
        parentPath: string | null;
        directories: FolderDir[];
      };
      setCurrentBrowserPath(data.currentPath);
      setBrowserParentPath(data.parentPath);
      setBrowserDirectories(data.directories || []);
    } finally {
      setIsBrowserLoading(false);
    }
  };

  const createFolder = async (input: { parentPath?: string; name: string }) => {
    const res = await apiFetch('/api/utils/create-folder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!res.ok) throw new Error(await res.text());
    return (await res.json()) as FolderDir;
  };

  const { data: projectFileEntries = [], isLoading: isProjectFilesLoading } = useQuery({
    queryKey: ['projectFiles', activeProjectId, rootProjectDirectory],
    queryFn: async () => {
      if (!activeProjectId) return [];
      const params = new URLSearchParams();
      if (rootProjectDirectory) params.set('path', rootProjectDirectory);
      const query = params.toString();
      const res = await apiFetch(
        `/api/repositories/${activeProjectId}/files${query ? `?${query}` : ''}`
      );
      if (!res.ok) throw new Error('Failed to fetch project files');
      return (await res.json()) as ProjectFileEntry[];
    },
    enabled: !!activeProjectId,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const mergedProjectFileEntriesByDirectory = useMemo<Record<string, ProjectFileEntry[]>>(
    () => ({ ...projectFileEntriesByDirectory, [rootProjectDirectory]: projectFileEntries }),
    [projectFileEntries, projectFileEntriesByDirectory]
  );

  const { data: selectedProjectFile = null, isLoading: isProjectFileLoading } = useQuery({
    queryKey: ['projectFile', activeProjectId, selectedProjectFilePath],
    queryFn: async () => {
      if (!activeProjectId || !selectedProjectFilePath) return null;
      const params = new URLSearchParams({ path: selectedProjectFilePath });
      const res = await apiFetch(`/api/repositories/${activeProjectId}/file?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to fetch project file');
      return (await res.json()) as ProjectFileContent;
    },
    enabled: !!activeProjectId && !!selectedProjectFilePath,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const toggleProjectDirectory = async (path: string) => {
    const nextExpanded = !expandedProjectDirectories[path];
    setExpandedProjectDirectories((prev) => ({ ...prev, [path]: nextExpanded }));
    if (!nextExpanded || mergedProjectFileEntriesByDirectory[path] || !activeProjectId) return;
    setLoadingProjectDirectories((prev) => ({ ...prev, [path]: true }));
    try {
      const params = new URLSearchParams({ path });
      const res = await apiFetch(`/api/repositories/${activeProjectId}/files?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to fetch project files');
      const entries = (await res.json()) as ProjectFileEntry[];
      setProjectFileEntriesByDirectory((prev) => ({ ...prev, [path]: entries }));
    } finally {
      setLoadingProjectDirectories((prev) => ({ ...prev, [path]: false }));
    }
  };

  return {
    currentBrowserPath,
    browserParentPath,
    browserDirectories,
    isBrowserLoading,
    fetchDirectories,
    createFolder,
    projectFileEntries,
    projectFileEntriesByDirectory: mergedProjectFileEntriesByDirectory,
    expandedProjectDirectories,
    loadingProjectDirectories,
    selectedProjectFile,
    selectedProjectFilePath,
    isProjectFilesLoading,
    isProjectFileLoading,
    setProjectFileEntriesByDirectory,
    toggleProjectDirectory,
    openProjectFile: setSelectedProjectFilePath,
  };
}
