import type { Meta, StoryObj } from '@storybook/react-vite';
import { Separator } from '../../../components/ui/separator';

const meta = {
  title: 'Components/Navigation & Layout/Separator',
  component: Separator,
  tags: ['autodocs'],
} satisfies Meta<typeof Separator>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <div className="w-[360px] space-y-6">
      <div className="space-y-4">
        <p className="text-xs font-medium text-muted-foreground uppercase">Default</p>
        <Separator />
      </div>
      <div className="space-y-4">
        <p className="text-xs font-medium text-muted-foreground uppercase">Thick (2px)</p>
        <Separator thickness="2" />
      </div>
      <div className="space-y-4">
        <p className="text-xs font-medium text-muted-foreground uppercase">Gradient Strong</p>
        <Separator thickness="2" gradient variant="strong" />
      </div>
      <div className="space-y-4">
        <p className="text-xs font-medium text-muted-foreground uppercase">Vertical (2px)</p>
        <div className="flex h-8 items-center gap-3">
          <span className="text-sm">Left</span>
          <Separator orientation="vertical" thickness="2" />
          <span className="text-sm">Right</span>
        </div>
      </div>
    </div>
  ),
};
