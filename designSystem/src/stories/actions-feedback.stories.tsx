import type { Meta, StoryObj } from '@storybook/react-vite';
import { Search } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '../components/ui/alert';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { IconButton } from '../components/ui/icon-button';

const meta = {
  title: 'Components/Actions & Feedback',
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Showcase: Story = {
  render: () => (
    <div className="grid gap-6">
      <section className="flex flex-wrap items-center gap-2">
        <Button>Default</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="outline">Outline</Button>
        <Button variant="destructive">Destructive</Button>
        <IconButton aria-label="Search">
          <Search />
        </IconButton>
      </section>
      <section className="flex flex-wrap items-center gap-2">
        <Badge>Default</Badge>
        <Badge variant="secondary">Secondary</Badge>
        <Badge variant="outline">Outline</Badge>
        <Badge variant="destructive">Destructive</Badge>
      </section>
      <section className="grid max-w-xl gap-3">
        <Alert>
          <AlertTitle>Heads up!</AlertTitle>
          <AlertDescription>Token settings are shared with .pen preview.</AlertDescription>
        </Alert>
        <Alert variant="destructive">
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>This action cannot be undone.</AlertDescription>
        </Alert>
      </section>
    </div>
  ),
};
