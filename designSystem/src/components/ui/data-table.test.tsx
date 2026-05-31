import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DataTable, DataTableContent, DataTableFooter, DataTableHeader } from './data-table';

describe('DataTable', () => {
  it('renders correctly', () => {
    render(
      <DataTable>
        <DataTableHeader>Header</DataTableHeader>
        <DataTableContent>Content</DataTableContent>
        <DataTableFooter>Footer</DataTableFooter>
      </DataTable>
    );

    expect(screen.getByText('Header')).toBeInTheDocument();
    expect(screen.getByText('Content')).toBeInTheDocument();
    expect(screen.getByText('Footer')).toBeInTheDocument();
  });
});
