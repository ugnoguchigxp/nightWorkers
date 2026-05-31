import type { Meta, StoryObj } from '@storybook/react-vite';
import { Search } from 'lucide-react';
import { IconButton } from '../../../components/ui/icon-button';

const meta = {
  title: 'Components/Actions & Feedback/Icon Button',
  component: IconButton,
  tags: ['autodocs'],
} satisfies Meta<typeof IconButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <IconButton aria-label="Search">
      <Search />
    </IconButton>
  ),
};
