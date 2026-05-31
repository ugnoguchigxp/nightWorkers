import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  AlertTriangle,
  Bed,
  BellRing,
  Boxes,
  Calendar,
  ClipboardList,
  Contact,
  Droplet,
  FileHeart,
  FileText,
  FlaskConical,
  History,
  Home,
  MessageSquare,
  Monitor,
  Pill,
  Settings,
  Settings2,
  SquarePen,
  Syringe,
  User,
  Users,
} from 'lucide-react';
import { useState } from 'react';

import { IconTreeMenu, type IconTreeMenuSection } from './IconTreeMenu';

const meta: Meta<typeof IconTreeMenu> = {
  title: 'Components/IconTreeMenu',
  component: IconTreeMenu,
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
  },
  decorators: [
    (Story) => (
      <div className="min-h-screen bg-background text-foreground p-8">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof IconTreeMenu>;

const sectionedMenuData: IconTreeMenuSection[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    tooltip: 'Dashboard',
    icon: <Home className="h-4 w-4" />,
    path: '/dashboard',
  },
  {
    id: 'workspace',
    label: 'Workspace',
    tooltip: 'Workspace',
    icon: <Home className="h-4 w-4" />,
    children: [
      { id: 'workspace/dashboard', label: 'Dashboard' },
      {
        id: 'workspace/schedules',
        label: 'Schedules',
        icon: <Calendar className="h-4 w-4" />,
        children: [
          { id: 'workspace/schedules/today', label: 'Today' },
          { id: 'workspace/schedules/weekly', label: 'Weekly plan' },
          { id: 'workspace/schedules/night', label: 'Night shift' },
        ],
      },
      {
        id: 'workspace/boards',
        label: 'Boards',
        icon: <ClipboardList className="h-4 w-4" />,
        children: [
          { id: 'workspace/boards/triage', label: 'Triage board' },
          { id: 'workspace/boards/kpi', label: 'KPI board' },
        ],
      },
      {
        id: 'workspace/messages',
        label: 'Messages',
        icon: <MessageSquare className="h-4 w-4" />,
        badge: 7,
      },
    ],
  },
  {
    id: 'patients',
    label: 'Patients',
    tooltip: 'Patients',
    icon: <Users className="h-4 w-4" />,
    badge: 12,
    children: [
      {
        id: 'patients/list',
        label: 'Patient list',
        icon: <User className="h-4 w-4" />,
        children: [
          { id: 'patients/list/all', label: 'All patients' },
          { id: 'patients/list/recent', label: 'Recent visits' },
          { id: 'patients/list/favorites', label: 'Favorites' },
        ],
      },
      {
        id: 'patients/treatment',
        label: 'Treatment',
        icon: <Bed className="h-4 w-4" />,
        children: [
          { id: 'patients/treatment/session', label: 'Session summary' },
          { id: 'patients/treatment/plan', label: 'Treatment plans' },
          { id: 'patients/treatment/events', label: 'Critical events' },
        ],
      },
      {
        id: 'patients/medication',
        label: 'Medication',
        icon: <Pill className="h-4 w-4" />,
        children: [
          {
            id: 'patients/medication/intradialytic',
            label: 'Intradialytic medication',
            icon: <Syringe className="h-4 w-4" />,
          },
          {
            id: 'patients/medication/ambulatory',
            label: 'Ambulatory medication',
          },
        ],
      },
      {
        id: 'patients/records',
        label: 'Records',
        icon: <FileHeart className="h-4 w-4" />,
        children: [
          { id: 'patients/records/wounds', label: 'Wounds' },
          { id: 'patients/records/fluid', label: 'Fluid balance' },
          { id: 'patients/records/complications', label: 'Complications' },
          { id: 'patients/records/lab', label: 'Lab results' },
        ],
      },
    ],
  },
  {
    id: 'operations',
    label: 'Operations',
    tooltip: 'Operations',
    icon: <FlaskConical className="h-4 w-4" />,
    children: [
      {
        id: 'operations/lab',
        label: 'Lab workflow',
        children: [
          { id: 'operations/lab/orders', label: 'Orders' },
          { id: 'operations/lab/results', label: 'Results review' },
          { id: 'operations/lab/pending', label: 'Pending checks', badge: 3 },
        ],
      },
      {
        id: 'operations/quality',
        label: 'Quality control',
        children: [
          { id: 'operations/quality/water', label: 'Water quality' },
          { id: 'operations/quality/infection', label: 'Infection alerts' },
          { id: 'operations/quality/supplies', label: 'Supply checks' },
        ],
      },
      {
        id: 'operations/safety',
        label: 'Safety incidents',
        icon: <AlertTriangle className="h-4 w-4" />,
        badge: 2,
      },
      {
        id: 'operations/fluid',
        label: 'Fluid monitoring',
        icon: <Droplet className="h-4 w-4" />,
      },
    ],
  },
  {
    id: 'components',
    label: 'Components',
    tooltip: 'Components',
    icon: <Boxes className="h-4 w-4" />,
    children: [
      {
        id: 'components/forms',
        label: 'Form demos',
        icon: <SquarePen className="h-4 w-4" />,
        children: [
          { id: 'components/forms/patient', label: 'Patient form' },
          { id: 'components/forms/orders', label: 'Order entry' },
          { id: 'components/forms/validation', label: 'Validation patterns' },
        ],
      },
      {
        id: 'components/tables',
        label: 'Table demos',
        children: [
          { id: 'components/tables/basic', label: 'Basic table' },
          { id: 'components/tables/virtualized', label: 'Virtualized table' },
          { id: 'components/tables/export', label: 'Export patterns' },
        ],
      },
      {
        id: 'components/changelog',
        label: 'Release notes',
        icon: <History className="h-4 w-4" />,
      },
    ],
  },
  {
    id: 'admin',
    label: 'Administration',
    tooltip: 'Administration',
    icon: <Settings2 className="h-4 w-4" />,
    children: [
      {
        id: 'admin/devices',
        label: 'Device management',
        icon: <Monitor className="h-4 w-4" />,
        children: [
          { id: 'admin/devices/monitors', label: 'Monitors' },
          { id: 'admin/devices/printers', label: 'Printers' },
          { id: 'admin/devices/calibrations', label: 'Calibrations' },
        ],
      },
      {
        id: 'admin/staff',
        label: 'Personnel',
        icon: <Contact className="h-4 w-4" />,
        children: [
          { id: 'admin/staff/roles', label: 'Roles' },
          { id: 'admin/staff/permissions', label: 'Permissions' },
          { id: 'admin/staff/audits', label: 'Audit logs' },
        ],
      },
      {
        id: 'admin/config',
        label: 'Basic settings',
        icon: <Settings className="h-4 w-4" />,
      },
      {
        id: 'admin/reports',
        label: 'Reports',
        icon: <FileText className="h-4 w-4" />,
      },
    ],
  },
  {
    id: 'alerts',
    label: 'Alerts',
    tooltip: 'Alerts',
    icon: <BellRing className="h-4 w-4" />,
    badge: 3,
    children: [
      {
        id: 'alerts/critical',
        label: 'Critical',
        children: [
          { id: 'alerts/critical/device', label: 'Device disconnected' },
          { id: 'alerts/critical/medication', label: 'Medication conflict' },
        ],
      },
      {
        id: 'alerts/warnings',
        label: 'Warnings',
        children: [
          { id: 'alerts/warnings/stock', label: 'Low stock' },
          { id: 'alerts/warnings/shift', label: 'Shift overrun' },
        ],
      },
    ],
  },
];

export const LargeSample: Story = {
  render: () => {
    const [activeSectionId, setActiveSectionId] = useState('workspace');
    const [lastNavigatedPath, setLastNavigatedPath] = useState<string | null>(null);
    const [selectedBySection, setSelectedBySection] = useState<Record<string, string>>({
      workspace: 'workspace/dashboard',
      patients: 'patients/list/all',
      operations: 'operations/lab/orders',
      components: 'components/forms/patient',
      admin: 'admin/devices/monitors',
      alerts: 'alerts/critical/device',
    });
    const [expandedBySection, setExpandedBySection] = useState<Record<string, string[]>>({
      workspace: ['workspace/schedules', 'workspace/boards'],
      patients: ['patients/list', 'patients/treatment', 'patients/records'],
      operations: ['operations/lab'],
      components: ['components/forms'],
      admin: ['admin/devices', 'admin/staff'],
      alerts: ['alerts/critical'],
    });

    return (
      <div className="h-[760px] w-full rounded-lg border border-border bg-card overflow-hidden">
        <div className="h-full grid grid-cols-1 lg:grid-cols-[420px_1fr]">
          <IconTreeMenu
            sections={sectionedMenuData}
            title="Main Menu"
            sectionId={activeSectionId}
            onSectionChange={(id) => setActiveSectionId(id)}
            onSectionNavigate={(path) => setLastNavigatedPath(path)}
            showSectionNameAsTitle={true}
            hideExpandCollapseButtons={true}
            selectedId={selectedBySection[activeSectionId]}
            onSelect={(id, _item, section) =>
              setSelectedBySection((prev) => ({ ...prev, [section.id]: id }))
            }
            expandedIds={expandedBySection[activeSectionId] ?? []}
            onExpandedChange={(nextExpandedIds, section) =>
              setExpandedBySection((prev) => ({
                ...prev,
                [section.id]: nextExpandedIds,
              }))
            }
          />
          <div className="hidden lg:flex flex-col border-s border-border p-6 bg-background">
            <div className="text-lg font-semibold text-foreground mb-2">Workbench Preview</div>
            <div className="text-sm text-muted-foreground mb-4">
              Icon-only rail (VSCode/Slack style) + collapsible section tree.
            </div>
            <div className="rounded-md border border-border bg-card p-4 space-y-3">
              <div>
                <div className="text-xs uppercase text-muted-foreground mb-1">Active section</div>
                <div className="text-sm font-medium text-foreground">{activeSectionId}</div>
              </div>
              <div>
                <div className="text-xs uppercase text-muted-foreground mb-1">
                  Last section route
                </div>
                <div className="text-sm font-medium text-foreground break-all">
                  {lastNavigatedPath ?? '-'}
                </div>
              </div>
              <div>
                <div className="text-xs uppercase text-muted-foreground mb-1">Selected item</div>
                <div className="text-sm font-medium text-foreground break-all">
                  {selectedBySection[activeSectionId]}
                </div>
              </div>
              <div>
                <div className="text-xs uppercase text-muted-foreground mb-1">Expanded folders</div>
                <div className="text-sm text-foreground break-all">
                  {(expandedBySection[activeSectionId] ?? []).join(', ') || '-'}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  },
};
