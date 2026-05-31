import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './tooltip';

describe('Tooltip', () => {
  it('shows content on hover', async () => {
    render(
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger>Hover me</TooltipTrigger>
          <TooltipContent>Tooltip message</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );

    const trigger = screen.getByText(/hover me/i);
    await userEvent.hover(trigger);

    expect(await screen.findByText('Tooltip message')).toBeInTheDocument();
  });
});
