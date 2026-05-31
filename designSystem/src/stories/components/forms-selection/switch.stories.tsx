import type { Meta, StoryObj } from '@storybook/react-vite';
import { Label } from '../../../components/ui/label';
import { Switch } from '../../../components/ui/switch';

const meta = {
  title: 'Components/Forms & Selection/Switch',
  component: Switch,
  tags: ['autodocs'],
} satisfies Meta<typeof Switch>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <div className="flex items-center gap-2">
      <Label htmlFor="notify">Notify</Label>
      <Switch id="notify" defaultChecked />
    </div>
  ),
};
