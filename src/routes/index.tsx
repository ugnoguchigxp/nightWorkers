import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { NightWorkersShell } from '../modules/nightworkers/components/NightWorkersShell';
import { useNightWorkersWorkspace } from '../modules/nightworkers/hooks/useNightWorkersWorkspace';

export const Route = createFileRoute('/')({
  component: NightWorkersHome,
});

function NightWorkersHome() {
  const workspace = useNightWorkersWorkspace();
  const [showSettings, setShowSettings] = useState(false);
  const [showFolderBrowser, setShowFolderBrowser] = useState(false);

  return (
    <NightWorkersShell
      workspace={workspace}
      showSettings={showSettings}
      onOpenSettings={() => setShowSettings(true)}
      onCloseSettings={() => setShowSettings(false)}
      showFolderBrowser={showFolderBrowser}
      onOpenFolderBrowser={() => setShowFolderBrowser(true)}
      onCloseFolderBrowser={() => setShowFolderBrowser(false)}
    />
  );
}
