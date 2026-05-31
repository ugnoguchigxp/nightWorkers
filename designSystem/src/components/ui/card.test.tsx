import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from './card';

describe('Card', () => {
  it('renders all sub-components correctly', () => {
    render(
      <Card>
        <CardHeader>
          <CardTitle>Card Title</CardTitle>
          <CardDescription>Card Description</CardDescription>
        </CardHeader>
        <CardContent>
          <p>Card Content</p>
        </CardContent>
        <CardFooter>
          <button type="button">Action</button>
        </CardFooter>
      </Card>
    );

    expect(screen.getByText('Card Title')).toBeInTheDocument();
    expect(screen.getByText('Card Description')).toBeInTheDocument();
    expect(screen.getByText('Card Content')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /action/i })).toBeInTheDocument();
  });

  it('applies custom classNames to all sub-components', () => {
    render(
      <Card className="card-custom">
        <CardHeader className="header-custom" />
        <CardContent className="content-custom" />
        <CardFooter className="footer-custom" />
      </Card>
    );

    // Get by class because they are mostly divs
    expect(document.querySelector('.card-custom')).toBeInTheDocument();
    expect(document.querySelector('.header-custom')).toBeInTheDocument();
    expect(document.querySelector('.content-custom')).toBeInTheDocument();
    expect(document.querySelector('.footer-custom')).toBeInTheDocument();
  });
});
