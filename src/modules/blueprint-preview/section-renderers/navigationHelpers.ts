import { toObjectArray } from '../previewModel';

export function navigationLinks(props: Record<string, unknown>) {
  const links = toObjectArray(props.links);
  return links.length > 0
    ? links
    : [
        { label: 'Overview', badge: 'Home' },
        { label: 'Runs', badge: '12' },
        { label: 'Blueprints', badge: 'New' },
        { label: 'Settings' },
      ];
}

export function navigationTabs(props: Record<string, unknown>) {
  return Array.isArray(props.tabs)
    ? props.tabs.map((tab) =>
        typeof tab === 'object' && tab
          ? String((tab as Record<string, unknown>).label || (tab as Record<string, unknown>).title)
          : String(tab)
      )
    : ['Overview', 'Activity', 'Artifacts', 'Blueprint'];
}
