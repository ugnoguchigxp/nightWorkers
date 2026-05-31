import type { Meta, StoryObj } from '@storybook/react-vite';
import { Label } from '../../../components/ui/label';

const meta = {
  title: 'Components/Forms & Selection/Label',
  component: Label,
  tags: ['autodocs'],
} satisfies Meta<typeof Label>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    children: 'Email Address',
  },
};
