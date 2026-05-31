import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from './accordion';

describe('Accordion', () => {
  it('renders and toggles correctly', async () => {
    render(
      <Accordion>
        <AccordionItem value="item-1">
          <AccordionTrigger>Is it accessible?</AccordionTrigger>
          <AccordionContent>Yes. It adheres to the WAI-ARIA design pattern.</AccordionContent>
        </AccordionItem>
      </Accordion>
    );

    const trigger = screen.getByRole('button', { name: /is it accessible/i });
    expect(trigger).toBeInTheDocument();

    // Initially content is hidden or has data-closed
    screen.queryByText(/yes\. it adheres/i);
    // BaseUI typically hides it or uses data-open/closed

    await userEvent.click(trigger);
    expect(screen.getByText(/yes\. it adheres/i)).toBeInTheDocument();
  });
});
