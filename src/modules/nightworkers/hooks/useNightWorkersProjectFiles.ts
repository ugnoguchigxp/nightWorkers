import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import {
  browseFolders,
  createFolder as createFolderCommand,
  fetchRepositoryFile,
  fetchRepositoryFiles,
} from '../nightWorkersCommands';
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
      const res = await browseFolders(targetPath);
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
    const res = await createFolderCommand(input);
    if (!res.ok) throw new Error(await res.text());
    return (await res.json()) as FolderDir;
  };

  const { data: projectFileEntries = [], isLoading: isProjectFilesLoading } = useQuery({
    queryKey: ['projectFiles', activeProjectId, rootProjectDirectory],
    queryFn: async () => {
      if (!activeProjectId) return [];
      const res = await fetchRepositoryFiles(activeProjectId, rootProjectDirectory);
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
      const res = await fetchRepositoryFile(activeProjectId, selectedProjectFilePath);
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
      const res = await fetchRepositoryFiles(activeProjectId, path);
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
