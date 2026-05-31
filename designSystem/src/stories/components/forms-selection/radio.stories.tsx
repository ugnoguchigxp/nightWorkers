import type { Meta, StoryObj } from '@storybook/react-vite';
import { Label } from '../../../components/ui/label';
import { Radio } from '../../../components/ui/radio';
import { RadioGroup } from '../../../components/ui/radio-group';

const meta = {
  title: 'Components/Forms & Selection/Radio',
  component: Radio,
  tags: ['autodocs'],
} satisfies Meta<typeof Radio>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { value: 'selected' },
  render: () => (
    <RadioGroup value="selected" className="gap-2">
      <div className="flex items-center gap-2">
        <Radio id="radio-selected" value="selected" />
        <Label htmlFor="radio-selected">Selected</Label>
      </div>
      <div className="flex items-center gap-2">
        <Radio id="radio-unselected" value="unselected" />
        <Label htmlFor="radio-unselected">Unselected</Label>
      </div>
    </RadioGroup>
  ),
};
