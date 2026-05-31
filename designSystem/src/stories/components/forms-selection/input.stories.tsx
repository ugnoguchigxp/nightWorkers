import type { Meta, StoryObj } from '@storybook/react-vite';
import { Input } from '../../../components/ui/input';

const meta = {
  title: 'Components/Forms & Selection/Input',
  component: Input,
  tags: ['autodocs'],
} satisfies Meta<typeof Input>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    placeholder: 'name@example.com',
    className: 'w-[320px]',
  },
};
