import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Bell, Home, Users } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';
import { IconTreeMenu, type IconTreeMenuSection } from '@/components/IconTreeMenu/IconTreeMenu';

const mockSections: IconTreeMenuSection[] = [
  {
    id: 'workspace',
    label: 'Workspace',
    tooltip: 'Workspace',
    icon: <Home className="h-4 w-4" />,
    children: [
      {
        id: 'workspace/folder',
        label: 'Folder',
        children: [{ id: 'workspace/folder/item', label: 'Item A' }],
      },
      { id: 'workspace/notes', label: 'Notes' },
    ],
  },
  {
    id: 'patients',
    label: 'Patients',
    tooltip: 'Patients',
    icon: <Users className="h-4 w-4" />,
    children: [{ id: 'patients/list', label: 'Patient list' }],
  },
  {
    id: 'alerts',
    label: 'Alerts',
    icon: <Bell className="h-4 w-4" />,
    path: '/alerts',
  },
];

describe('IconTreeMenu', () => {
  const user = userEvent.setup();

  it('renders icon buttons and the first section tree', () => {
    render(<IconTreeMenu sections={mockSections} />);

    expect(screen.getByLabelText('Workspace')).toBeInTheDocument();
    expect(screen.getByLabelText('Patients')).toBeInTheDocument();
    expect(screen.getByLabelText('Alerts')).toBeInTheDocument();
    expect(screen.getByText('Folder')).toBeInTheDocument();
    expect(screen.getByText('Notes')).toBeInTheDocument();
  });

  it('switches section when icon button is clicked', async () => {
    render(<IconTreeMenu sections={mockSections} />);

    await user.click(screen.getByLabelText('Patients'));
    expect(screen.getByText('Patient list')).toBeInTheDocument();
    expect(screen.queryByText('Folder')).not.toBeInTheDocument();
  });

  it('calls onSelect with active section context', async () => {
    const onSelect = vi.fn();
    render(<IconTreeMenu sections={mockSections} onSelect={onSelect} />);

    await user.click(screen.getByLabelText('Patients'));
    await user.click(screen.getByText('Patient list'));

    expect(onSelect).toHaveBeenCalledWith(
      'patients/list',
      expect.objectContaining({ id: 'patients/list' }),
      expect.objectContaining({ id: 'patients' })
    );
  });

  it('calls onExpandedChange with active section context', async () => {
    const onExpandedChange = vi.fn();
    render(<IconTreeMenu sections={mockSections} onExpandedChange={onExpandedChange} />);

    await user.click(screen.getByLabelText('Expand'));

    expect(onExpandedChange).toHaveBeenCalledWith(
      expect.arrayContaining(['workspace/folder']),
      expect.objectContaining({ id: 'workspace' })
    );
  });

  it('calls onSectionNavigate for leaf section with path', async () => {
    const onSectionNavigate = vi.fn();
    render(<IconTreeMenu sections={mockSections} onSectionNavigate={onSectionNavigate} />);

    await user.click(screen.getByLabelText('Alerts'));

    expect(onSectionNavigate).toHaveBeenCalledWith(
      '/alerts',
      expect.objectContaining({ id: 'alerts' })
    );
    expect(screen.queryByRole('tree')).not.toBeInTheDocument();
    expect(screen.queryByText('This section has no submenu.')).not.toBeInTheDocument();
  });

  it('can show leaf panel text when hidePanelWhenNoChildren is false', async () => {
    render(<IconTreeMenu sections={mockSections} hidePanelWhenNoChildren={false} />);

    await user.click(screen.getByLabelText('Alerts'));

    expect(screen.getByText('This section has no submenu.')).toBeInTheDocument();
  });

  it('shows selected section label as title when enabled', async () => {
    render(
      <IconTreeMenu sections={mockSections} title="Static title" showSectionNameAsTitle={true} />
    );

    expect(screen.getByText('Workspace')).toBeInTheDocument();
    await user.click(screen.getByLabelText('Patients'));
    expect(screen.getByText('Patients')).toBeInTheDocument();
    expect(screen.queryByText('Static title')).not.toBeInTheDocument();
  });

  it('hides expand/collapse-all buttons on request', () => {
    render(<IconTreeMenu sections={mockSections} hideExpandCollapseButtons={true} />);

    expect(screen.queryByLabelText('Expand all')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Collapse all')).not.toBeInTheDocument();
  });

  it('shows tooltip content on hover', async () => {
    render(<IconTreeMenu sections={mockSections} />);

    await user.hover(screen.getByLabelText('Alerts'));

    expect(await screen.findByText('Alerts')).toBeInTheDocument();
  });
});
