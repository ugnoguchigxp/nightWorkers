import { PreviewTable } from '../BlueprintPreviewPrimitives';
import { previewColumns, previewRows } from '../previewModel';
import type { SectionRendererInput } from './types';

export function renderDataTableSection({ componentName, props, t }: SectionRendererInput) {
  const columns = previewColumns(props);
  const rows = previewRows(props, columns, 8);
  return <PreviewTable columns={columns} rows={rows} />;
}
