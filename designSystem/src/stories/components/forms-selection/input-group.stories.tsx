import type { Meta, StoryObj } from '@storybook/react-vite';
import { Input } from '../../../components/ui/input';
import { InputGroup, InputGroupLabel } from '../../../components/ui/input-group';

const meta = {
  title: 'Components/Forms & Selection/Input Group',
  component: InputGroup,
  tags: ['autodocs'],
} satisfies Meta<typeof InputGroup>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <InputGroup className="w-[320px]">
      <InputGroupLabel htmlFor="project-name">Project Name</InputGroupLabel>
      <Input id="project-name" placeholder="hono-standard" />
    </InputGroup>
  ),
};
