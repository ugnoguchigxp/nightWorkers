import type { Meta, StoryObj } from '@storybook/react-vite';
import { Textarea } from '../../../components/ui/textarea';

const meta = {
  title: 'Components/Forms & Selection/Textarea',
  component: Textarea,
  tags: ['autodocs'],
} satisfies Meta<typeof Textarea>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    placeholder: 'Type your message...',
    className: 'w-[420px]',
  },
};
