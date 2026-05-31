import type { Meta, StoryObj } from '@storybook/react-vite';
import { Checkbox } from '../../../components/ui/checkbox';
import { Label } from '../../../components/ui/label';

const meta = {
  title: 'Components/Forms & Selection/Checkbox',
  component: Checkbox,
  tags: ['autodocs'],
} satisfies Meta<typeof Checkbox>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <div className="flex items-center gap-2">
      <Checkbox id="accept" defaultChecked />
      <Label htmlFor="accept">Accept terms</Label>
    </div>
  ),
};
