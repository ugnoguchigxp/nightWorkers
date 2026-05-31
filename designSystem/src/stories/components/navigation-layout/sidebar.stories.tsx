import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarItem,
  SidebarSectionTitle,
} from '../../../components/ui/sidebar';

const meta = {
  title: 'Components/Navigation & Layout/Sidebar',
  component: Sidebar,
  tags: ['autodocs'],
} satisfies Meta<typeof Sidebar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <div className="h-[320px] w-[260px]">
      <Sidebar className="h-full w-full">
        <SidebarHeader>Workspace</SidebarHeader>
        <SidebarContent>
          <SidebarSectionTitle>Main</SidebarSectionTitle>
          <SidebarItem className="bg-sidebar-accent text-sidebar-accent-foreground">
            Dashboard
          </SidebarItem>
          <SidebarItem>Members</SidebarItem>
          <SidebarItem>Settings</SidebarItem>
        </SidebarContent>
        <SidebarFooter>v1.0.0</SidebarFooter>
      </Sidebar>
    </div>
  ),
};
