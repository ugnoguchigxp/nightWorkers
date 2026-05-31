import type { Meta, StoryObj } from '@storybook/react-vite';
import { Progress } from '../../../components/ui/progress';

const meta = {
  title: 'Components/Actions & Feedback/Progress',
  component: Progress,
  tags: ['autodocs'],
} satisfies Meta<typeof Progress>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    value: 66,
    className: 'w-[320px]',
  },
};
