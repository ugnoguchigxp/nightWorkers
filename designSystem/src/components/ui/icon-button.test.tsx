import { render, screen } from '@testing-library/react';
import { Search } from 'lucide-react';
import { describe, expect, it } from 'vitest';
import { IconButton } from './icon-button';

describe('IconButton', () => {
  it('renders correctly', () => {
    render(
      <IconButton aria-label="Search">
        <Search />
      </IconButton>
    );
    const button = screen.getByRole('button', { name: /search/i });
    expect(button).toBeInTheDocument();
    expect(button).toHaveClass('h-[var(--control-size-icon)]');
    expect(button).toHaveClass('w-[var(--control-size-icon)]');
  });
});
