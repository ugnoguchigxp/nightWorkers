import type { Meta, StoryObj } from '@storybook/react-vite';
import { List, ListDivider, ListItem, ListSearchBox, ListTitle } from '../../../components/ui/list';

const meta = {
  title: 'Components/Data Display/List',
  component: List,
  tags: ['autodocs'],
} satisfies Meta<typeof List>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <List className="w-[320px]">
      <ListTitle>Team Members</ListTitle>
      <ListSearchBox>Search members...</ListSearchBox>
      <ListDivider />
      <ListItem checked>Alice</ListItem>
      <ListItem>Bob</ListItem>
      <ListItem>Carol</ListItem>
    </List>
  ),
};
