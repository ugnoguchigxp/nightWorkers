import type { Meta, StoryObj } from '@storybook/react-vite';
import { Badge } from '../../../components/ui/badge';
import {
  DataTable,
  DataTableContent,
  DataTableFooter,
  DataTableHeader,
} from '../../../components/ui/data-table';

const meta = {
  title: 'Components/Data Display/Data Table',
  component: DataTable,
  tags: ['autodocs'],
} satisfies Meta<typeof DataTable>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <DataTable className="w-[560px]">
      <DataTableHeader>
        <p className="text-sm font-medium">Users</p>
        <Badge variant="outline">3 records</Badge>
      </DataTableHeader>
      <DataTableContent className="space-y-2 text-sm">
        <div className="flex items-center justify-between">
          <span>Alice</span>
          <span className="text-muted-foreground">Owner</span>
        </div>
        <div className="flex items-center justify-between">
          <span>Bob</span>
          <span className="text-muted-foreground">Editor</span>
        </div>
      </DataTableContent>
      <DataTableFooter className="text-sm text-muted-foreground">
        Updated 2 minutes ago
      </DataTableFooter>
    </DataTable>
  ),
};
