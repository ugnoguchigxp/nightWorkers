import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '../../../components/ui/accordion';

const meta = {
  title: 'Components/Data Display/Accordion',
  component: Accordion,
  tags: ['autodocs'],
} satisfies Meta<typeof Accordion>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Accordion defaultValue={['item-1']} className="flex w-[480px] flex-col gap-2">
      <AccordionItem value="item-1">
        <AccordionTrigger>What is this design system?</AccordionTrigger>
        <AccordionContent>Reusable UI components for the Hono standard app.</AccordionContent>
      </AccordionItem>
      <AccordionItem value="item-2">
        <AccordionTrigger>Is it token-driven?</AccordionTrigger>
        <AccordionContent>Yes. It follows shadcn/ui + Tailwind design tokens.</AccordionContent>
      </AccordionItem>
      <AccordionItem value="item-3">
        <AccordionTrigger>How do I customize it?</AccordionTrigger>
        <AccordionContent>
          Override CSS variables in styles.css or use Tailwind arbitrary values.
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  ),
};
